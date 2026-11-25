package com.clicpos.app.fiscal;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;

import javax.xml.parsers.DocumentBuilderFactory;

import org.apache.xml.security.signature.XMLSignature;
import org.junit.BeforeClass;
import org.junit.Test;
import org.w3c.dom.Document;
import org.w3c.dom.Element;

public class FiscalXmlSignerQaTest {
    private static final String XMLDSIG = "http://www.w3.org/2000/09/xmldsig#";
    private static final String ISSUER = "999999999";
    private static final String SALE = "E320000000001";
    private static final String NOTE = "E340000000001";
    private static PrivateKey key;
    private static X509Certificate certificate;

    @BeforeClass
    public static void generateSigningMaterial() throws Exception {
        Path directory = Files.createTempDirectory("clic-firma-sintetica");
        Path keystore = directory.resolve("synthetic.p12");
        char[] password = "fixture-only".toCharArray();
        try {
            String keytool = Path.of(System.getProperty("java.home"), "bin", "keytool").toString();
            Process process = new ProcessBuilder(keytool, "-genkeypair", "-alias", "synthetic",
                    "-keyalg", "RSA", "-keysize", "2048", "-dname", "CN=TEST FISCAL SIN VALIDEZ",
                    "-storetype", "PKCS12", "-keystore", keystore.toString(), "-storepass", "fixture-only")
                    .redirectErrorStream(true).start();
            byte[] output = process.getInputStream().readAllBytes();
            assertEquals(new String(output), 0, process.waitFor());
            KeyStore store = KeyStore.getInstance("PKCS12");
            try (var input = Files.newInputStream(keystore)) {
                store.load(input, password);
            }
            key = (PrivateKey) store.getKey("synthetic", password);
            certificate = (X509Certificate) store.getCertificate("synthetic");
        } finally {
            Files.deleteIfExists(keystore);
            Files.deleteIfExists(directory);
        }
    }

    @Test
    public void consumerSaleAndSummaryVerifyAndShareSecurityCode() throws Exception {
        var signer = new FiscalXmlSignerQa(key, certificate);
        Document invoice = xml("ECF", "32", SALE, "192.00", "");
        Document summary = xml("RFCE", "32", SALE, "192.00", "");
        var result = signer.signConsumerSale(invoice, summary, ISSUER, SALE);
        Document signedInvoice = parse(result.ecf);
        Document signedSummary = parse(result.rfce);
        assertTrue(verify(signedInvoice));
        assertTrue(verify(signedSummary));
        String value = signedInvoice.getElementsByTagNameNS(XMLDSIG, "SignatureValue")
                .item(0).getTextContent().trim();
        assertEquals(value.substring(0, 6), signedSummary.getElementsByTagName("CodigoSeguridadeCF")
                .item(0).getTextContent());
        assertEquals(0, invoice.getElementsByTagNameNS(XMLDSIG, "Signature").getLength());
        assertEquals("AAAAAA", summary.getElementsByTagName("CodigoSeguridadeCF").item(0).getTextContent());

        // Same fixture, timestamp and key. Replay must retain the original bytes in the future outbox.
        assertArrayEquals(result.ecf, signer.signConsumerSale(invoice, summary, ISSUER, SALE).ecf);
        signedSummary.getElementsByTagName("MontoTotal").item(0).setTextContent("193.00");
        assertFalse(verify(signedSummary));
    }

    @Test
    public void creditNoteRequiresTheAuthorizedOriginalAndVerifies() throws Exception {
        var signer = new FiscalXmlSignerQa(key, certificate);
        Document note = xml("ECF", "34", NOTE, "192.00", SALE);
        assertTrue(verify(parse(signer.signCreditNote(note, ISSUER, NOTE, SALE))));
        assertThrows(IllegalArgumentException.class, () ->
                signer.signCreditNote(note, ISSUER, NOTE, "E320000000002"));
    }

    @Test
    public void summaryMustMatchInvoiceIdentityTotalAndThreshold() throws Exception {
        var signer = new FiscalXmlSignerQa(key, certificate);
        Document invoice = xml("ECF", "32", SALE, "192.00", "");
        assertThrows(IllegalArgumentException.class, () -> signer.signConsumerSale(invoice,
                xml("RFCE", "32", "E320000000002", "192.00", ""), ISSUER, SALE));
        assertThrows(IllegalArgumentException.class, () -> signer.signConsumerSale(invoice,
                xml("RFCE", "32", SALE, "193.00", ""), ISSUER, SALE));
        assertThrows(IllegalArgumentException.class, () -> signer.signConsumerSale(
                xml("ECF", "32", SALE, "250000.00", ""), xml("RFCE", "32", SALE, "250000.00", ""),
                ISSUER, SALE));
    }

    private static boolean verify(Document document) throws Exception {
        Element element = (Element) document.getElementsByTagNameNS(XMLDSIG, "Signature").item(0);
        return new XMLSignature(element, "", true).checkSignatureValue(certificate);
    }

    private static Document xml(String root, String type, String ncf, String total, String original)
            throws Exception {
        String securityCode = root.equals("RFCE") ? "<CodigoSeguridadeCF>AAAAAA</CodigoSeguridadeCF>" : "";
        String reference = original.isEmpty() ? "" : "<InformacionReferencia><NCFModificado>"
                + original + "</NCFModificado></InformacionReferencia>";
        String xml = "<" + root + "><Encabezado><IdDoc><TipoeCF>" + type + "</TipoeCF><eNCF>" + ncf
                + "</eNCF></IdDoc><Emisor><RNCEmisor>" + ISSUER + "</RNCEmisor></Emisor><Totales><MontoTotal>"
                + total + "</MontoTotal></Totales>" + securityCode + "</Encabezado>" + reference + "</" + root + ">";
        return parse(xml.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }

    private static Document parse(byte[] xml) throws Exception {
        var factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        return factory.newDocumentBuilder().parse(new ByteArrayInputStream(xml));
    }
}
