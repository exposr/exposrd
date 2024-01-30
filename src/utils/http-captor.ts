import contentTypeParser from 'content-type';
import net from 'net';
import http from 'http';

class CaptureError extends Error {
    public readonly err: Error;
    public readonly code: string;
    public readonly message: string;

    constructor(err: any) {
        super();
        this.message = err.message;
        this.code = err.code;
        this.err = err;
    }
}

const captureData = (chunk: Buffer, capturedLength: number, limit: number, encoding: BufferEncoding): Buffer  => {
    const avail = limit - capturedLength;
    const c = avail < chunk.length ? chunk.subarray(0, avail) : chunk;
    return Buffer.isBuffer(c) ? c : Buffer.from(c, encoding || 'utf-8');
};

const capturable = (contentType: string | undefined): boolean => {
    const types = [
        'application/json',
        'text/plain',
        'text/html'
    ];
    return contentType != undefined && types.includes(contentType);
}

const parseContentType = (contentType?: string): contentTypeParser.ParsedMediaType | undefined => {
    if (!contentType) {
        return undefined
    }

    try {
        return contentTypeParser.parse(contentType);
    } catch (e: any) {
        return undefined;
    }
};

const HTTP_HEADER_X_FORWARDED_FOR = 'x-forwarded-for';
const requestClientIp = (req: http.IncomingMessage): string | undefined => {
    let ip: string | undefined = undefined;
    if (typeof req.headers[HTTP_HEADER_X_FORWARDED_FOR] == 'string') {
        ip = req.headers[HTTP_HEADER_X_FORWARDED_FOR].split(/\s*,\s*/)[0];
    }
    return (ip && net.isIP(ip)) ? ip : req.socket.remoteAddress;
}

export type HttpCaptorOpts = {
    request: http.IncomingMessage;
    response: http.ServerResponse<http.IncomingMessage>;
    opts?: {
        limit?: number;
        captureRequestBody?: boolean;
        captureResponseBody?: boolean;
    }
};

type CaptureRequest = {
    length: number;
    capturedLength: number;
    payload: Buffer;
    captured: boolean;
};

type CaptureResponse = {
    length: number;
    capturedLength: number;
    payload: Buffer;
    captured: boolean;
    headers: http.OutgoingHttpHeaders;
};

type CaptureResult = {
    client: {
        remoteAddr: string | undefined;
        remoteFamily: string | undefined;
        ip: string | undefined;
    };
    meta: {
        requestBody: {
            length: number;
            capturedLength: number;
            captured: boolean;
        };
        responseBody: {
            length: number;
            capturedLength: number;
            captured: boolean;
        };
    };
    version: string;
    duration: number;
    request: {
        method: string;
        path: string;
        headers: http.IncomingHttpHeaders;
        length: number;
        body: string | undefined;
        error: string | undefined;
    };
    response?: {
        status: number;
        message: string;
        headers: http.OutgoingHttpHeaders;
        length: number;
        body: string | undefined;
        error: string | undefined;
    }
};

class HttpCaptor {

    public captureRequestBody: boolean;
    public captureResponseBody: boolean;
    private limit: number;

    private _request: http.IncomingMessage;
    private _response: http.ServerResponse<http.IncomingMessage>;

    constructor(args: HttpCaptorOpts) {
        const {request, response, opts} = args;
        this._request = request;
        this._response = response;

        this.limit = opts?.limit || 1*1024;
        this.captureRequestBody = opts?.captureRequestBody || false;
        this.captureResponseBody = opts?.captureResponseBody || false;
    }

    private async _captureRequest(): Promise<CaptureRequest> {
        const data: Array<Buffer> = [];
        let length = 0;
        let capturedLength = 0;

        let contentType: contentTypeParser.ParsedMediaType | undefined;
        const getContentType = (): contentTypeParser.ParsedMediaType => {
            if (contentType) {
                return contentType;
            }
            const ct = parseContentType(this._request.headers['content-type']);
            contentType = ct;
            return contentType || {type: <any>undefined, parameters: {}};
        };

        const handleData = (chunk: Buffer): void => {
            const {type, parameters} = getContentType();
            if (this.captureRequestBody && capturable(type) && capturedLength < this.limit) {
                const c = captureData(chunk, capturedLength, this.limit, <any>parameters["charset"]);
                data.push(c);
                capturedLength += c.length;
            }
            length += chunk.length;
        };

        const assemble = (): Buffer => {
            return Buffer.concat(data, capturedLength);
        };

        return new Promise((resolve, reject) => {

            const done = (err: Error) => {
                this._request.off('data', handleData);
                this._request.off('end', done);
                this._request.off('error', done);
                if (err) {
                    reject(new CaptureError(err));
                } else {
                    const {type, parameters} = getContentType();
                    resolve({
                        length,
                        capturedLength,
                        payload: assemble(),
                        captured: capturable(type),
                    });
                }
            };

            const onListener = (event: string, listener: (...args: any[]) => void) => {
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

    private async _captureResponse(): Promise<CaptureResponse> {
        const data: Array<Buffer> = [];
        let length = 0;
        let capturedLength = 0;

        if (!this._response) {
            return new Promise((resolve, reject) => {
                reject(new CaptureError(new Error('No response to capture')));
            });
        }

        let headers: http.OutgoingHttpHeaders | undefined;
        const getHeaders = (): http.OutgoingHttpHeaders => {
            if (headers) {
                return headers;
            }
            return {
                ...this._response.getHeaders()
            }
        }

        let contentType: contentTypeParser.ParsedMediaType | undefined;
        const getContentType = (): contentTypeParser.ParsedMediaType => {
            if (contentType) {
                return contentType;
            }
            const ct = getHeaders()['content-type'];
            if (typeof ct == 'string') {
                contentType = parseContentType(ct);
            }
            return contentType || {type: <any>undefined, parameters: {}};
        };

        const saveChunk = (chunk: Buffer): void => {
            if (!chunk) {
                return;
            }
            const {type, parameters} = getContentType();
            if (this.captureResponseBody && capturable(type) && capturedLength < this.limit) {
                const c = captureData(chunk, capturedLength, this.limit, <any>parameters["charset"]);
                data.push(c);
                capturedLength += c.length;
            }
            length += chunk.length;
        };

        const canonicalWrite = this._response.write;
        this._response.write = (...args: Array<any>) => {
            saveChunk(args[0]);
            return canonicalWrite.apply(this._response, <any>args);
        };

        const canonicalEnd = this._response.end;
        this._response.end = (...args: Array<any>) => {
            if (args[0] instanceof Buffer) {
                saveChunk(args[0]);
            }
            return canonicalEnd.apply(this._response, <any>args);
        };

        const canonicalWriteHead = this._response.writeHead;
        this._response.writeHead = (...args: Array<any>) => {
            headers = args[1] as http.OutgoingHttpHeaders;
            return canonicalWriteHead.apply(this._response, <any>args)
        };

        const assemble = () => {
            return Buffer.concat(data, capturedLength);
        };

        return new Promise((resolve, reject) => {

            const done = (err: Error) => {
                this._response.write = canonicalWrite;
                this._response.end = canonicalEnd;
                this._response.writeHead = canonicalWriteHead;
                this._response.off('finish', done);
                this._response.off('close', done);
                this._response.off('error', done);

                if (err) {
                    reject(new CaptureError(err));
                } else {

                    const {type, parameters} = getContentType();
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
    }

    public async capture(): Promise<CaptureResult> {
        return new Promise(async (resolve, reject) => {
            const startTime = process.hrtime.bigint();

            const [requestResult, responseResult] = await Promise.allSettled([
                this._captureRequest(),
                this._captureResponse()
            ]);

            const capturedRequest = requestResult.status == 'fulfilled' ? requestResult.value : undefined;
            const requestError = requestResult.status == 'rejected' ? requestResult.reason?.message : undefined;

            const capturedResponse = responseResult.status == 'fulfilled' ? responseResult.value : undefined;
            const responseError = responseResult.status == 'rejected' ? responseResult?.reason?.message : undefined;

            const elapsedMs = Math.round(Number((process.hrtime.bigint() - BigInt(startTime))) / 1e6);

            const formatBody = (body: CaptureRequest | CaptureResponse | undefined, shouldCapture: boolean): string | undefined => {
                if (body == undefined) {
                    return undefined
                }
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

            const result: CaptureResult = {
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
                        captured: capturedResponse?.captured || false,
                    }
                },
                version: this._request.httpVersion,
                duration: elapsedMs,
                request: {
                    method: this._request.method || "UNKNOWN",
                    path: this._request.url || "",
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
                    headers: capturedResponse?.headers || {},
                    length: capturedResponse?.length || 0,
                    body: formatBody(capturedResponse, this.captureResponseBody),
                    error: responseError,
                }
            }
            resolve(result)
        });
    }
}

export default HttpCaptor;