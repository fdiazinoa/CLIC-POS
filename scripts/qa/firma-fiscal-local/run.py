"""Run the fiscal signature lab with a fresh synthetic key and a disposable SQLite inbox."""

import argparse
import hashlib
import math
from pathlib import Path
import sqlite3
import subprocess
import tempfile
from xml.etree import ElementTree


def retain(connection, kind, payload):
    document = ElementTree.fromstring(payload)
    issuer = document.findtext("./Encabezado/Emisor/RNCEmisor")
    ncf = document.findtext("./Encabezado/IdDoc/eNCF")
    digest = hashlib.sha256(payload).digest()
    identity = (issuer, ncf, kind)
    with connection:
        connection.execute(
            "INSERT INTO inbox VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
            (*identity, digest, payload),
        )
        retained_digest, retained_bytes = connection.execute(
            "SELECT digest, payload FROM inbox WHERE issuer = ? AND ncf = ? AND kind = ?",
            identity,
        ).fetchone()
        if retained_digest != digest or retained_bytes != payload:
            raise ValueError("El mismo comprobante llegó con bytes diferentes")
    return digest


def check_replay(directory):
    path = directory / "inbox.sqlite"
    payloads = {kind: (directory / f"{kind}.xml").read_bytes() for kind in ("E32", "RFCE", "E34")}
    connection = sqlite3.connect(path)
    connection.execute(
        """CREATE TABLE inbox (
            issuer TEXT NOT NULL, ncf TEXT NOT NULL, kind TEXT NOT NULL,
            digest BLOB NOT NULL, payload BLOB NOT NULL, PRIMARY KEY (issuer, ncf, kind)
        )"""
    )
    receipts = {kind: retain(connection, kind, payload) for kind, payload in payloads.items()}
    connection.close()
    connection = sqlite3.connect(path)
    for kind, payload in payloads.items():
        if retain(connection, kind, payload) != receipts[kind]:
            raise AssertionError(f"El reintento de {kind} cambió el acuse")
        try:
            retain(connection, kind, payload.replace(b"<MontoTotal>192.00", b"<MontoTotal>193.00"))
        except ValueError:
            pass
        else:
            raise AssertionError(f"El buzón aceptó bytes distintos para {kind}")
    count = connection.execute("SELECT count(*) FROM inbox").fetchone()[0]
    connection.close()
    if count != len(payloads):
        raise AssertionError("El reintento dejó documentos duplicados")
    print("SQLite: conserva los bytes tras reabrir el buzón, deduplica reintentos y rechaza conflictos.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("schemas", type=Path, help="directorio con los XSD E32, E34 y RFCE disponibles")
    args = parser.parse_args()
    sources = Path(__file__).resolve().parent
    with tempfile.TemporaryDirectory() as temporary:
        directory = Path(temporary)
        subprocess.run(
            [
                "keytool", "-genkeypair", "-alias", "synthetic", "-keyalg", "RSA",
                "-keysize", "2048", "-dname", "CN=CLIC POS LAB SIN VALIDEZ FISCAL",
                "-validity", "1", "-storetype", "PKCS12",
                "-keystore", str(directory / "synthetic.p12"), "-storepass", "lab-only",
            ],
            check=True,
            capture_output=True,
        )
        result = subprocess.run(
            ["java", str(sources / "FiscalSigningLab.java"), str(directory), str(sources),
             str(args.schemas.resolve())],
            check=True,
            stdout=subprocess.PIPE,
            text=True,
        )
        timings = {kind: [] for kind in ("E32 + RFCE", "E34")}
        validated = []
        for line in result.stdout.splitlines():
            kind, value = line.split(",")
            if kind == "xsd":
                validated.append(value)
            else:
                timings[kind].append(int(value))
        for kind, values in timings.items():
            samples = sorted(values)
            p50, p95 = (samples[math.ceil(len(samples) * p) - 1] / 1e6 for p in (0.50, 0.95))
            print(f"{kind:12} n={len(samples)} p50={p50:.2f} ms p95={p95:.2f} ms")
        print(f"Firma y alteración de monto verificadas. XSD verificados: {', '.join(validated) or 'ninguno'}.")
        check_replay(directory)


if __name__ == "__main__":
    main()
