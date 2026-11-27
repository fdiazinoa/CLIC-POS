package com.clicpos.app.fiscal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.os.Bundle;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.util.Log;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import java.io.ByteArrayInputStream;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.cert.X509Certificate;
import java.util.UUID;
import javax.security.auth.x500.X500Principal;
import javax.xml.parsers.DocumentBuilderFactory;

import org.apache.xml.security.signature.XMLSignature;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.w3c.dom.Document;
import org.w3c.dom.Element;

@RunWith(AndroidJUnit4.class)
public class FiscalXmlSignerInstrumentedQaTest {
    private static final String DS = "http://www.w3.org/2000/09/xmldsig#";

    @Test
    public void signsAndVerifiesTheThreeFiscalArtifactsWithAnAndroidKey() throws Exception {
        String alias = "clic-pos-synthetic-fiscal-qa-" + UUID.randomUUID();
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        try {
            var generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, "AndroidKeyStore");
            generator.initialize(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY)
                    .setKeySize(2048)
                    .setDigests(KeyProperties.DIGEST_SHA256)
                    .setSignaturePaddings(KeyProperties.SIGNATURE_PADDING_RSA_PKCS1)
                    .setCertificateSubject(new X500Principal("CN=SINTETICO QA"))
                    .build());
            var key = generator.generateKeyPair().getPrivate();
            var certificate = (X509Certificate) store.getCertificate(alias);
            var signer = new FiscalXmlSignerQa(key, certificate);
            var builders = DocumentBuilderFactory.newInstance();
            builders.setNamespaceAware(true);
            var parser = builders.newDocumentBuilder();
            var assets = InstrumentationRegistry.getInstrumentation().getContext().getAssets();
            Document invoice, summary, note;
            try (var e32 = assets.open("fiscal/E32.xml");
                 var rfce = assets.open("fiscal/RFCE.xml");
                 var e34 = assets.open("fiscal/E34.xml")) {
                invoice = parser.parse(e32);
                summary = parser.parse(rfce);
                note = parser.parse(e34);
            }

            long signedAt = System.currentTimeMillis();
            long startedSale = System.nanoTime();
            var signedSale = signer.signConsumerSale(invoice, summary, "999999999", "E320000000001");
            long saleMs = (System.nanoTime() - startedSale) / 1_000_000;
            long startedNote = System.nanoTime();
            var signedNote = signer.signCreditNote(note, "999999999", "E340000000001", "E320000000001");
            long noteMs = (System.nanoTime() - startedNote) / 1_000_000;

            var parsedSale = parser.parse(new ByteArrayInputStream(signedSale.ecf));
            var parsedSummary = parser.parse(new ByteArrayInputStream(signedSale.rfce));
            var parsedNote = parser.parse(new ByteArrayInputStream(signedNote));
            for (Document document : new Document[]{parsedSale, parsedSummary, parsedNote}) {
                Element signature = (Element) document.getElementsByTagNameNS(DS, "Signature").item(0);
                assertTrue(new XMLSignature(signature, "", true).checkSignatureValue(certificate));
            }
            String code = parsedSale.getElementsByTagNameNS(DS, "SignatureValue").item(0)
                    .getTextContent().trim().substring(0, 6);
            assertEquals(code, parsedSummary.getElementsByTagName("CodigoSeguridadeCF").item(0).getTextContent());
            assertEquals("E320000000001", parsedNote.getElementsByTagName("NCFModificado").item(0).getTextContent());
            Log.i("FiscalSigningQa", "E32+RFCE=" + saleMs + " ms E34=" + noteMs + " ms");
            if ("true".equals(InstrumentationRegistry.getArguments().getString("exportSyntheticReceipt"))) {
                var evidence = new Bundle();
                evidence.putString("qaEcf", Base64.encodeToString(signedSale.ecf, Base64.NO_WRAP));
                evidence.putString("qaRfce", Base64.encodeToString(signedSale.rfce, Base64.NO_WRAP));
                evidence.putLong("qaSignMs", saleMs);
                evidence.putLong("qaSignStartedAt", signedAt);
                InstrumentationRegistry.getInstrumentation().sendStatus(2, evidence);
            }
        } finally {
            store.deleteEntry(alias);
        }
    }
}
