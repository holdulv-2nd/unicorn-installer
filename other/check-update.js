const https = require('https');
const fs = require('fs');

const REPFAL_BASE = 'https://repfal.betaflare.workers.dev';

function checkUpdateInfo() {
    return new Promise((resolve, reject) => {
        https.get(`${REPFAL_BASE}/latest.json`, res => {
            console.log('Status Code:', res.statusCode);
            console.log('Headers:', res.headers);
            
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    console.log('Update info:', JSON.stringify(json, null, 2));
                    resolve(json);
                } catch (err) {
                    console.error('Raw response:', data);
                    reject(err);
                }
            });
        }).on('error', reject);
    });
}

checkUpdateInfo().catch(console.error);