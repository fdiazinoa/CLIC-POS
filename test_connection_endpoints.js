
import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:3001';

async function testEndpoints() {
    console.log('🧪 Starting verification tests...');

    // 1. Test /api/sync/identify
    try {
        console.log('Testing GET /api/sync/identify...');
        const resIdentify = await fetch(`${BASE_URL}/api/sync/identify`);
        const identifyData = await resIdentify.json();

        if (resIdentify.ok && identifyData.status === 'online' && identifyData.role === 'MASTER') {
            console.log('✅ /api/sync/identify is working correctly.');
            console.log('Data:', JSON.stringify(identifyData));
        } else {
            console.error('❌ /api/sync/identify failed:', identifyData);
        }
    } catch (e) {
        console.error('❌ Error testing /api/sync/identify:', e.message);
    }

    // 2. Test /api/config
    try {
        console.log('Testing GET /api/config...');
        const resConfig = await fetch(`${BASE_URL}/api/config`);
        const configData = await resConfig.json();

        // Check if it's a singleton (should NOT have 'result' wrapper)
        if (resConfig.ok && !configData.result && configData.terminals) {
            console.log('✅ /api/config is returning singleton directly.');
        } else if (configData.result) {
            console.error('❌ /api/config is still wrapped in "result":', configData);
        } else {
            console.error('❌ /api/config failed or unexpected structure:', configData);
        }
    } catch (e) {
        console.error('❌ Error testing /api/config:', e.message);
    }
}

testEndpoints();
