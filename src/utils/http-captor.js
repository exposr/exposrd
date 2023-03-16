import contentTypeParser from 'content-type';
import net from 'net';

class CaptureError extends Error {
    constructor(err) {
        super();
        this.message = err.message;
        this.code = err.code;
        this.err = err;
    }
}

const captureData = (chunk, capturedLength, limit, encoding) => {
    const avail = limit - capturedLength;
    const c = avail < chunk.length ? chunk.slice(0, avail) : chunk;
    return Buffer.isBuffer(c) ? c : Buffer.from(c, encoding || 'utf-8');
};

const capturable = (contentType) => {
    const types = [
        'application/json',
        'text/plain',
        'text/html'
    ];
    return types.includes(contentType);
}

const parseContentType = (contentType) => {
    try {
        return contentTypeParser.parse(contentType);
    } catch (e) {
        return undefined;
    }
};

const HTTP_HEADER_X_FORWARDED_FOR = 'x-forwarded-for';
const requestClientIp = (req) => {
    let ip;
    if (req.headers[HTTP_HEADER_X_FORWARDED_FOR]) {
        ip = req.headers[HTTP_HEADER_X_FORWARDED_FOR].split(/\s*,\s*/)[0];
    }
    return net.isIP(ip) ? ip : req.socket.remoteAddress;
}

class HttpCaptor {
    constructor(args) {
        const {request, response, opts} = args;
        this._request = request;
        this._response = response;

        this.limit = opts?.limit || 1*1024;
        this.captureRequestBody = opts?.captureRequestBody || false;
        this.captureResponseBody = opts?.captureResponseBody || false;
    }

    _captureRequest() {
        const data = [];
        let length = 0;
        let capturedLength = 0;

        let contentType;
        const getContentType = () => {
            if (contentType) {
                return contentType;
            }
            contentType = parseContentType(this._request.headers['content-type']);
            return contentType || {};
        };

        const handleData = (chunk) => {
            const {type, params} = getContentType();
            if (this.captureRequestBody && capturable(type) && capturedLength < this.limit) {
                const c = captureData(chunk, capturedLength, this.limit, params?.charset);
                data.push(c);
                capturedLength += c.length;
            }
            length += chunk.length;
        };

        const assemble = () => {
            return Buffer.concat(data, capturedLength);
        };

        return new Promise((resolve, reject) => {

            const done = (err) => {
                this._request.off('data', handleData);
                this._request.off('end', done);
                this._request.off('error', done);
                if (err) {
                    reject(new CaptureError(err));
                } else {
                    const {type, _} = getContentType();
                    resolve({
                        length,
                        capturedLength,
                        payload: assemble(),
                        captured: capturable(type),
                    });
                }
            };

            const onListener = (event, listener) => {
                if (event === 'data') {
                    this._request.off('newListener', onListener);
                    this._request.on('data', handleData);
                }
            };
            this._request.on('newListener', onListener);
            this._request.once('end', done);
            this._request.once('error', done);
        });
    }

    _captureResponse = () => {
        const data = [];
        let headers;
        let length = 0;
        let capturedLength = 0;

        if (!this._response) {
            return new Promise((resolve, reject) => {
                resolve({});
            })
        }

        const getHeaders = () => {
            if (headers) {
                return headers;
            }
            return {
                ...this._response.getHeaders()
            }
        }

        let contentType;
        const getContentType = () => {
            if (contentType) {
                return contentType;
            }
            contentType = parseContentType(getHeaders()['content-type']);
            return contentType || {};
        };

        const saveChunk = (chunk) => {
            if (!chunk) {
                return;
            }
            const {type, params} = getContentType();
            if (this.captureResponseBody && capturable(type) && capturedLength < this.limit) {
                const c = captureData(chunk, capturedLength, this.limit, params?.charset);
                data.push(c);
                capturedLength += c.length;
            }
            length += chunk.length;
        };

        const canonicalWrite = this._response.write;
        this._response.write = (chunk) => {
            saveChunk(chunk);
            return canonicalWrite.apply(this._response, [chunk]);
        };

        const canonicalEnd = this._response.end;
        this._response.end = (chunk) => {
            saveChunk(chunk);
            return canonicalEnd.apply(this._response, [chunk]);
        };

        const canonicalWriteHead = this._response.writeHead;
        this._response.writeHead = (...args) => {
            headers = args[1];
            return canonicalWriteHead.apply(this._response, args)
        };

        const assemble = () => {
            return Buffer.concat(data, capturedLength);
        };

        return new Promise((resolve, reject) => {

            const done = (err) => {
                this._response.write = canonicalWrite;
                this._response.end = canonicalEnd;
                this._response.writeHead = canonicalWriteHead;
                this._response.off('finish', done);
                this._response.off('close', done);
                this._response.off('error', done);

                if (err) {
                    reject(new CaptureError(err));
                } else {

                    const {type, _} = getContentType();
                    resolve({
                        length,
                        capturedLength,
                        payload: assemble(),
                        captured: capturable(type),
                        headers: getHeaders(),
                    });
                }
            };

            this._response.once('finish', done);
            this._response.once('close', done);
            this._response.once('error', done);
        });

    };

    capture() {
        return new Promise(async (resolve, reject) => {
            const startTime = process.hrtime.bigint();

            const [requestResult, responseResult] = await Promise.allSettled([
                this._captureRequest(),
                this._captureResponse()
            ]);

            const capturedRequest = requestResult.value;
            const requestError = requestResult.reason?.message;

            const capturedResponse = responseResult.value;
            const responseError = responseResult?.reason?.message;

            const elapsedMs = Math.round(Number((process.hrtime.bigint() - BigInt(startTime))) / 1e6);

            const formatBody = (body, shouldCapture) => {
                let payload;
                if (body?.captured) {
                    payload = body.capturedLength > 0 ? body.payload.toString('utf-8') : undefined;
                    if (payload && body.length != body.capturedLength) {
                        payload += `...[truncated ${body.length - body.capturedLength} more bytes]`;
                    }
                } else if (shouldCapture && body?.length > 0) {
                    payload = `[binary ${body.length} bytes]`;
                }
                return payload;
            };

            const result = {
                client: {
                    remoteAddr: this._request.socket.remoteAddress,
                    remoteFamily: this._request.socket.remoteFamily,
                    ip: requestClientIp(this._request),
                },
                meta: {
                    requestBody: {
                        length: capturedRequest?.length || 0,
                        capturedLength: capturedRequest?.capturedLength || 0,
                        captured: capturedRequest?.captured || false,
                    },
                    responseBody: {
                        length: capturedResponse?.length || 0,
                        capturedLength: capturedResponse?.capturedLength || 0,
                        captured: capturedResponse?.captured || false,
                    }
                },
                version: this._request.httpVersion,
                duration: elapsedMs,
                request: {
                    method: this._request.method,
                    path: this._request.url,
                    headers: this._request.headers,
                    length: capturedRequest?.length || 0,
                    body: formatBody(capturedRequest, this.captureRequestBody),
                    error: requestError,
                },
            };
            if (this._response) {
                result.response = {
                    status: this._response?.statusCode,
                    message: this._response?.statusMessage,
                    headers: capturedResponse?.headers,
                    length: capturedResponse?.length,
                    body: formatBody(capturedResponse, this.captureResponseBody),
                    error: responseError,
                }
            }
            resolve(result)
        });
    }
}

export default HttpCaptor;