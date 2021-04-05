class CustomError extends Error {
    constructor(code, message) {
        super();
        this.code = `${code}`;
        this.errno = code;
        this.message = message || this.code;
    }
}

export default CustomError;