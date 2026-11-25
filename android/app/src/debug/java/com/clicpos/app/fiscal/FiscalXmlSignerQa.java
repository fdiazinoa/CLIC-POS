package com.clicpos.app.fiscal;

import android.content.Context;
import android.security.KeyChain;

import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.cert.X509Certificate;

import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.transform.OutputKeys;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;

import org.apache.xml.security.Init;
import org.apache.xml.security.algorithms.MessageDigestAlgorithm;
import org.apache.xml.security.c14n.Canonicalizer;
import org.apache.xml.security.signature.XMLSignature;
import org.apache.xml.security.transforms.Transforms;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;

/** QA component for documents built from server-authorized fiscal facts by a trusted caller. */
final class FiscalXmlSignerQa {
    private static final String XMLDSIG = "http://www.w3.org/2000/09/xmldsig#";
    private static final BigDecimal RFCE_THRESHOLD = new BigDecimal("250000.00");

    private final PrivateKey key;
    private final X509Certificate certificate;

    FiscalXmlSignerQa(PrivateKey key, X509Certificate certificate) {
        this.key = key;
        this.certificate = certificate;
    }

    /** Opens the pre-provisioned certificate for one operation, on a worker thread. */
    static FiscalXmlSignerQa open(Context context, String alias, byte[] approvedFingerprint)
            throws Exception {
        if (alias == null || alias.trim().isEmpty()
                || approvedFingerprint == null || approvedFingerprint.length != 32) {
            throw new IllegalArgumentException("FISCAL_SIGNING_CERTIFICATE_AUTHORITY_REQUIRED");
        }

        Context application = context.getApplicationContext();
        X509Certificate[] chain = KeyChain.getCertificateChain(application, alias);
        if (chain == null || chain.length == 0) {
            throw new IllegalStateException("FISCAL_SIGNING_CERTIFICATE_UNAVAILABLE");
        }
        X509Certificate certificate = chain[0];
        verifyCertificateFingerprint(certificate, approvedFingerprint);

        PrivateKey privateKey = KeyChain.getPrivateKey(application, alias);
        if (privateKey == null) throw new IllegalStateException("FISCAL_SIGNING_KEY_UNAVAILABLE");
        return new FiscalXmlSignerQa(privateKey, certificate);
    }

    static void verifyCertificateFingerprint(X509Certificate certificate, byte[] approvedFingerprint)
            throws GeneralSecurityException {
        certificate.checkValidity();
        byte[] actual = MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded());
        if (!MessageDigest.isEqual(approvedFingerprint, actual)) {
            throw new IllegalStateException("FISCAL_SIGNING_CERTIFICATE_FINGERPRINT_MISMATCH");
        }
    }

    /** A local possession proof over a random, non-document challenge. No signature is returned. */
    void verifyKeyAccess() throws GeneralSecurityException {
        byte[] purpose = "CLIC-POS QA KeyChain possession".getBytes(StandardCharsets.US_ASCII);
        byte[] nonce = new byte[32];
        new SecureRandom().nextBytes(nonce);
        Signature signer = Signature.getInstance("SHA256withRSA");
        signer.initSign(key);
        signer.update(purpose);
        signer.update(nonce);
        byte[] signed = signer.sign();

        Signature verifier = Signature.getInstance("SHA256withRSA");
        verifier.initVerify(certificate.getPublicKey());
        verifier.update(purpose);
        verifier.update(nonce);
        if (!verifier.verify(signed)) {
            throw new GeneralSecurityException("FISCAL_SIGNING_KEY_CERTIFICATE_MISMATCH");
        }
    }

    static final class SignedSale {
        final byte[] ecf;
        final byte[] rfce;

        SignedSale(byte[] ecf, byte[] rfce) {
            this.ecf = ecf;
            this.rfce = rfce;
        }
    }

    SignedSale signConsumerSale(
            Document invoice, Document summary, String issuer, String ncf) throws Exception {
        Document sale = unsignedCopy(invoice, "ECF", "32", issuer, ncf);
        Document rfce = unsignedCopy(summary, "RFCE", "32", issuer, ncf);
        Element saleHeader = child(sale.getDocumentElement(), "Encabezado");
        Element summaryHeader = child(rfce.getDocumentElement(), "Encabezado");
        BigDecimal saleTotal = total(saleHeader);
        if (saleTotal.signum() < 0 || saleTotal.compareTo(RFCE_THRESHOLD) >= 0
                || saleTotal.compareTo(total(summaryHeader)) != 0) {
            throw new IllegalArgumentException("FISCAL_SIGNING_RFCE_TOTAL_MISMATCH");
        }

        byte[] ecfBytes = sign(sale);
        String signatureValue = sale.getElementsByTagNameNS(XMLDSIG, "SignatureValue")
                .item(0).getTextContent().trim();
        child(summaryHeader, "CodigoSeguridadeCF").setTextContent(signatureValue.substring(0, 6));
        return new SignedSale(ecfBytes, sign(rfce));
    }

    byte[] signCreditNote(
            Document note, String issuer, String ncf, String originalNcf) throws Exception {
        Document credit = unsignedCopy(note, "ECF", "34", issuer, ncf);
        Element reference = child(credit.getDocumentElement(), "InformacionReferencia");
        if (originalNcf == null || !originalNcf.matches("E32[0-9]{10}")
                || !originalNcf.equals(child(reference, "NCFModificado").getTextContent())) {
            throw new IllegalArgumentException("FISCAL_SIGNING_ORIGINAL_NCF_MISMATCH");
        }
        return sign(credit);
    }

    private static Document unsignedCopy(
            Document input, String rootName, String type, String issuer, String ncf) throws Exception {
        Element root = input.getDocumentElement();
        if (root == null || !rootName.equals(root.getLocalName()) || root.getNamespaceURI() != null
                || input.getDoctype() != null || input.getElementsByTagNameNS(XMLDSIG, "Signature").getLength() != 0) {
            throw new IllegalArgumentException("FISCAL_SIGNING_UNSIGNED_DOCUMENT_REQUIRED");
        }

        Element header = child(root, "Encabezado");
        Element id = child(header, "IdDoc");
        if (issuer == null || !issuer.matches("[0-9]{9}([0-9]{2})?")
                || !issuer.equals(child(child(header, "Emisor"), "RNCEmisor").getTextContent())
                || !type.equals(child(id, "TipoeCF").getTextContent())
                || ncf == null || !ncf.matches("E" + type + "[0-9]{10}")
                || !ncf.equals(child(id, "eNCF").getTextContent())) {
            throw new IllegalArgumentException("FISCAL_SIGNING_DOCUMENT_IDENTITY_MISMATCH");
        }

        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        Document copy = factory.newDocumentBuilder().newDocument();
        copy.appendChild(copy.importNode(root, true));
        return copy;
    }

    private static BigDecimal total(Element header) {
        return new BigDecimal(child(child(header, "Totales"), "MontoTotal").getTextContent());
    }

    private static Element child(Element parent, String name) {
        Element found = null;
        for (Node node = parent.getFirstChild(); node != null; node = node.getNextSibling()) {
            if (node instanceof Element && node.getNamespaceURI() == null && name.equals(node.getNodeName())) {
                if (found != null) throw new IllegalArgumentException("FISCAL_SIGNING_DUPLICATE_ELEMENT");
                found = (Element) node;
            }
        }
        if (found == null) throw new IllegalArgumentException("FISCAL_SIGNING_REQUIRED_ELEMENT_MISSING");
        return found;
    }

    private byte[] sign(Document document) throws Exception {
        certificate.checkValidity();
        if (!"RSA".equalsIgnoreCase(certificate.getPublicKey().getAlgorithm())) {
            throw new IllegalArgumentException("FISCAL_SIGNING_RSA_CERTIFICATE_REQUIRED");
        }

        Init.init();
        XMLSignature signature = new XMLSignature(document, "", XMLSignature.ALGO_ID_SIGNATURE_RSA_SHA256,
                Canonicalizer.ALGO_ID_C14N_OMIT_COMMENTS);
        document.getDocumentElement().appendChild(signature.getElement());
        Transforms transforms = new Transforms(document);
        transforms.addTransform(Transforms.TRANSFORM_ENVELOPED_SIGNATURE);
        signature.addDocument("", transforms, MessageDigestAlgorithm.ALGO_ID_DIGEST_SHA256);
        signature.addKeyInfo(certificate);
        signature.sign(key);
        if (!signature.checkSignatureValue(certificate)) {
            throw new IllegalArgumentException("FISCAL_SIGNING_KEY_CERTIFICATE_MISMATCH");
        }

        ByteArrayOutputStream output = new ByteArrayOutputStream();
        var transformer = TransformerFactory.newInstance().newTransformer();
        transformer.setOutputProperty(OutputKeys.ENCODING, "UTF-8");
        transformer.setOutputProperty(OutputKeys.INDENT, "no");
        transformer.transform(new DOMSource(document), new StreamResult(output));
        return output.toByteArray();
    }
}
