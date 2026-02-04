import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:3001'; // Direct backend port

async function run() {
    try {
        console.log('1. Authenticating...');
        const authRes = await fetch(`${BASE_URL}/api/sync/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ terminalId: 'debug-client', deviceToken: 'debug-token' })
        });
        
        if (!authRes.ok) {
            console.error('Auth failed:', authRes.status, await authRes.text());
            return;
        }

        const authData: any = await authRes.json();
        const token = authData.token;
        console.log('Token received:', token);

        console.log('\n2. Fetching Terminals...');
        const termRes = await fetch(`${BASE_URL}/api/sync/terminals`, {
            headers: { 'X-Sync-Token': token }
        });
        const termData = await termRes.json();
        console.log('Terminals Response:', JSON.stringify(termData, null, 2));

        console.log('\n3. Fetching Operational Status...');
        const opRes = await fetch(`${BASE_URL}/api/sync/operational-status`, {
            headers: { 'X-Sync-Token': token }
        });
        const opData = await opRes.json();
        console.log('Operational Response:', JSON.stringify(opData, null, 2));

    } catch (e) {
        console.error('Error:', e);
    }
}

run();
