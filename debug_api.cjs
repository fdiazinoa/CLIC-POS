const http = require('http');

const postData = JSON.stringify({ terminalId: 'debug-client', deviceToken: 'debug-token' });

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/sync/auth',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': postData.length
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('Body: ' + data);
    try {
        const json = JSON.parse(data);
        const token = json.token;
        if(token) fetchTerminals(token);
    } catch(e) { console.error(e); }
  });
});

req.on('error', (e) => {
  console.error('problem with request: ' + e.message);
});

req.write(postData);
req.end();

function fetchTerminals(token) {
    const opts = {
        hostname: 'localhost',
        port: 3001,
        path: '/api/sync/terminals',
        method: 'GET',
        headers: {
            'X-Sync-Token': token
        }
    };
    http.get(opts, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
            console.log('Terminals: ' + data);
            require('fs').writeFileSync('debug_output.txt', data);
        });
    });
}
