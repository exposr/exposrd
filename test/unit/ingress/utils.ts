import http from 'http';

export const httpRequest = async (opts: http.RequestOptions, buffer?: string | undefined): Promise<{status: number | undefined, data: any}> => {
    const result: {status: number | undefined, data: any} = await new Promise((resolve) => {
        const req = http.request(opts,
          (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('close', () => { resolve({status: res.statusCode, data})});
        });
        req.end(buffer);
    });
    return result;
}