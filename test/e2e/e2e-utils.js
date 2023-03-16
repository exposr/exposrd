import http from 'http';
import child_process from 'child_process';
import ssh from 'ssh2';
import net from 'net';

const baseApi = "http://localhost:8080";

export const sshClient = (host, port, username, password, target) => {
    const client = new ssh.Client();

    client.on('error', (err) => {
         console.log(err);
    })

    client.on('ready', () => {
        client.forwardIn(target.hostname, 0, (err, port) => {
        }).on('tcp connection', (info, accept, reject) => {
            const targetSock = net.connect(target.port, target.hostname, () => {
                const sock = accept();
                targetSock.pipe(sock);
                sock.pipe(targetSock);
            }).on('error', (err) => {
                reject()
              });
        });
    });

    client.connect({
        host,
        port: parseInt(port),
        username,
        password,
        //debug: (str) => { console.log(str) }
    });

    return () => {
        client.destroy();
    };
};

export const createEchoServer = async (port = 10000) => {
    const server = http.createServer();

    server.on('request', (request, response) => {
        let body = [];
        request.on('data', (chunk) => {
            body.push(chunk);
        }).on('end', () => {
            body = Buffer.concat(body).toString();
            response.statusCode = 200;
            response.end(body);
        });
    }).listen(port);

    return async () => {
        server.removeAllListeners('request');
        server.close();
    };
};

export const createAccount = async () => {
    try {
    const res = await fetch(`${baseApi}/v1/account`, {
        method: 'POST'
    });
    return res.json();
    } catch (e) {
        console.log(e);
    }
};

export const getAuthToken = async (accountId) => {
    const res = await fetch(`${baseApi}/v1/account/${accountId}/token`);
    const data = await res.json();
    return data.token;
};

export const putTunnel = async (authToken, tunnelId, opts = {}) => {
    const res = await fetch(`${baseApi}/v1/tunnel/${tunnelId}`, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(opts)
    });
    return res;
}

export const getTunnel = async(authToken, tunnelId) => {
    const res = await fetch(`${baseApi}/v1/tunnel/${tunnelId}`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${authToken}`
        },
    });
    return res;
};

export const startExposr = (args) => {
    const obj = child_process.spawn("docker", ["run", "--rm", "-t", "--add-host", "host.docker.internal:host-gateway", "exposr/exposr:latest",
        "--non-interactive",
        "-s", "http://host.docker.internal:8080",
    ].concat(args), {detached: true});

    let buf = '';
    obj.stdout.on('data', (data) => {
        data = buf + data.toString('utf-8');
        if (data.indexOf('\n') != -1) {
            console.log(`exposr-cli output "${data.slice(0, -1)}"`);
        } else {
            buf = data;
        }
    })

    return () => {
        process.kill(-obj.pid, 'SIGKILL');
    };
};