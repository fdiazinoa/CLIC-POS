const parseArgs = () => {
    const args = process.argv.slice(2);
    const parsed = {};

    for (let i = 0; i < args.length; i += 1) {
        const current = args[i];
        if (!current.startsWith("--")) continue;

        const key = current.slice(2);
        const next = args[i + 1];
        parsed[key] = next && !next.startsWith("--") ? next : "true";
        if (parsed[key] === next) i += 1;
    }

    return parsed;
};

const args = parseArgs();
const baseUrl = args["base-url"] || "http://127.0.0.1:3001";
const tenantId = args["tenant-id"] || null;
const tenantSlug = args["tenant-slug"] || null;
const tenantEmail = args["tenant-email"] || null;
const deviceId = args["device-id"] || "smoke-master-device";
const terminalId = args["terminal-id"] || "MASTER-01";
const terminalName = args["terminal-name"] || terminalId;
const hostname = args.hostname || "apk-master-smoke";
const firstIp = args["local-ip"] || "192.168.10.20";
const secondIp = args["rotate-ip"] || "192.168.10.21";

if (!tenantId && !tenantSlug && !tenantEmail) {
    throw new Error("Provide --tenant-id, --tenant-slug or --tenant-email.");
}

const buildPublishPayload = (localIp) => ({
    tenantId,
    tenantSlug,
    tenantEmail,
    deviceId,
    terminalId,
    terminalName,
    hostname,
    protocol: "http",
    port: 3001,
    localIp,
    localIps: [localIp],
    endpointUrl: `http://${localIp}:3001`,
    isPrimary: true,
});

const publishEndpoint = async (localIp) => {
    const response = await fetch(`${baseUrl}/api/cloud/master-endpoint/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPublishPayload(localIp)),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(`Publish failed (${response.status}): ${JSON.stringify(payload)}`);
    }

    return payload.endpoint;
};

const resolveEndpoint = async () => {
    const query = new URLSearchParams();
    if (tenantId) query.set("tenantId", tenantId);
    if (tenantSlug) query.set("tenantSlug", tenantSlug);
    if (tenantEmail) query.set("tenantEmail", tenantEmail);

    const response = await fetch(`${baseUrl}/api/cloud/master-endpoint/resolve?${query.toString()}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(`Resolve failed (${response.status}): ${JSON.stringify(payload)}`);
    }

    return payload.endpoint;
};

console.log(`Using local APK server: ${baseUrl}`);

const firstPublish = await publishEndpoint(firstIp);
const firstResolve = await resolveEndpoint();

console.log("\nFirst publish:");
console.log(JSON.stringify(firstPublish, null, 2));
console.log("\nFirst resolve:");
console.log(JSON.stringify(firstResolve, null, 2));

if (!firstPublish?.localIp) {
    throw new Error("First publish did not return a localIp.");
}

if (!firstResolve || firstResolve.localIp !== firstPublish.localIp) {
    throw new Error(`Expected first resolved IP ${firstPublish.localIp}, got ${firstResolve?.localIp || "null"}`);
}

const secondPublish = await publishEndpoint(secondIp);
const secondResolve = await resolveEndpoint();

console.log("\nRotated publish:");
console.log(JSON.stringify(secondPublish, null, 2));
console.log("\nRotated resolve:");
console.log(JSON.stringify(secondResolve, null, 2));

if (!secondPublish?.localIp) {
    throw new Error("Rotated publish did not return a localIp.");
}

if (!secondResolve || secondResolve.localIp !== secondPublish.localIp) {
    throw new Error(`Expected rotated resolved IP ${secondPublish.localIp}, got ${secondResolve?.localIp || "null"}`);
}

if (secondPublish.localIp === firstPublish.localIp) {
    console.warn(
        `\nWarning: requested rotation (${secondIp}) did not produce a new local interface. ` +
        `The APK normalized to ${secondPublish.localIp}.`
    );
}

console.log("\nCloud master discovery verification OK.");
