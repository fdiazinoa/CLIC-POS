import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.cert.X509Certificate;
import java.util.List;
import java.util.Map;

import javax.xml.XMLConstants;
import javax.xml.crypto.dsig.CanonicalizationMethod;
import javax.xml.crypto.dsig.DigestMethod;
import javax.xml.crypto.dsig.SignatureMethod;
import javax.xml.crypto.dsig.Transform;
import javax.xml.crypto.dsig.XMLSignature;
import javax.xml.crypto.dsig.XMLSignatureFactory;
import javax.xml.crypto.dsig.dom.DOMSignContext;
import javax.xml.crypto.dsig.dom.DOMValidateContext;
import javax.xml.crypto.dsig.spec.C14NMethodParameterSpec;
import javax.xml.crypto.dsig.spec.TransformParameterSpec;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;
import javax.xml.transform.stream.StreamSource;
import javax.xml.validation.SchemaFactory;

import org.w3c.dom.Document;

public class FiscalSigningLab {
    private static final XMLSignatureFactory SIGNATURES = XMLSignatureFactory.getInstance("DOM");

    public static void main(String[] args) throws Exception {
        Path directory = Path.of(args[0]);
        char[] password = "lab-only".toCharArray();
        KeyStore store = KeyStore.getInstance("PKCS12");
        try (var input = Files.newInputStream(directory.resolve("synthetic.p12"))) {
            store.load(input, password);
        }
        var key = (PrivateKey) store.getKey("synthetic", password);
        var certificate = (X509Certificate) store.getCertificate("synthetic");
        var schemas = SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);
        schemas.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        schemas.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");

        Path fixtures = Path.of(args[1]);
        byte[] sale = readFixture(fixtures.resolve("E32.xml"));
        byte[] summary = readFixture(fixtures.resolve("RFCE.xml"));
        byte[] creditNote = readFixture(fixtures.resolve("E34.xml"));
        byte[] signedSale = null;
        byte[] signedSummary = null;
        byte[] signedCreditNote = null;
        for (int index = 0; index < 105; index++) {
            long started = System.nanoTime();
            Document saleDocument = parse(sale);
            signedSale = sign(saleDocument, key, certificate);
            Document summaryDocument = parse(summary);
            summaryDocument.getElementsByTagName("CodigoSeguridadeCF").item(0)
                .setTextContent(securityCode(saleDocument));
            signedSummary = sign(summaryDocument, key, certificate);
            long saleDuration = System.nanoTime() - started;

            started = System.nanoTime();
            signedCreditNote = sign(parse(creditNote), key, certificate);
            long creditNoteDuration = System.nanoTime() - started;
            if (index >= 5) {
                System.out.println("E32 + RFCE," + saleDuration);
                System.out.println("E34," + creditNoteDuration);
            }
            for (byte[] signed : List.of(signedSale, signedSummary, signedCreditNote)) {
                if (!verify(signed, certificate.getPublicKey())) {
                    throw new IllegalStateException("La firma no valida");
                }
            }
        }

        var samples = Map.of("E32", signedSale, "RFCE", signedSummary, "E34", signedCreditNote);
        for (var sample : samples.entrySet()) {
            String kind = sample.getKey();
            byte[] signed = sample.getValue();
            Path path = directory.resolve(kind + ".xml");
            Files.write(path, signed);
            Path schema = Path.of(args[2]).resolve(kind + ".xsd");
            if (Files.isRegularFile(schema)) {
                schemas.newSchema(schema.toFile()).newValidator().validate(new StreamSource(path.toFile()));
                System.out.println("xsd," + kind);
            }
            Document altered = parse(signed);
            altered.getElementsByTagName("MontoTotal").item(0).setTextContent("193.00");
            if (verify(serialize(altered), certificate.getPublicKey())) {
                throw new IllegalStateException(kind + ": se aceptó un monto alterado");
            }
        }
    }

    private static byte[] readFixture(Path path) throws Exception {
        return Files.readString(path).replaceAll(">\\s+<", "><").strip()
            .getBytes(StandardCharsets.UTF_8);
    }

    private static byte[] sign(Document document, PrivateKey key, X509Certificate certificate)
        throws Exception {
        var enveloped = SIGNATURES.newTransform(Transform.ENVELOPED, (TransformParameterSpec) null);
        var digest = SIGNATURES.newDigestMethod(DigestMethod.SHA256, null);
        var reference = SIGNATURES.newReference("", digest, List.of(enveloped), null, null);
        var canonicalization = SIGNATURES.newCanonicalizationMethod(
            CanonicalizationMethod.INCLUSIVE, (C14NMethodParameterSpec) null);
        var method = SIGNATURES.newSignatureMethod(SignatureMethod.RSA_SHA256, null);
        var signedInfo = SIGNATURES.newSignedInfo(canonicalization, method, List.of(reference));
        var keys = SIGNATURES.getKeyInfoFactory();
        var keyInfo = keys.newKeyInfo(List.of(keys.newX509Data(List.of(certificate))));
        var context = new DOMSignContext(key, document.getDocumentElement());
        SIGNATURES.newXMLSignature(signedInfo, keyInfo).sign(context);
        return serialize(document);
    }

    private static boolean verify(byte[] xml, PublicKey key) throws Exception {
        var nodes = parse(xml).getElementsByTagNameNS(XMLSignature.XMLNS, "Signature");
        if (nodes.getLength() != 1) {
            return false;
        }
        var context = new DOMValidateContext(key, nodes.item(0));
        context.setProperty("org.jcp.xml.dsig.secureValidation", true);
        return SIGNATURES.unmarshalXMLSignature(context).validate(context);
    }

    private static String securityCode(Document document) {
        return document.getElementsByTagNameNS(XMLSignature.XMLNS, "SignatureValue")
            .item(0).getTextContent().substring(0, 6);
    }

    private static Document parse(byte[] bytes) throws Exception {
        var builders = DocumentBuilderFactory.newInstance();
        builders.setNamespaceAware(true);
        builders.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        builders.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        builders.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
        return builders.newDocumentBuilder().parse(new ByteArrayInputStream(bytes));
    }

    private static byte[] serialize(Document document) throws Exception {
        var result = new ByteArrayOutputStream();
        TransformerFactory.newInstance().newTransformer()
            .transform(new DOMSource(document), new StreamResult(result));
        return result.toByteArray();
    }
}
