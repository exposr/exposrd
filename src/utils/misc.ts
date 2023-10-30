import crypto from 'crypto';

export function symDifference<T>(a: Array<T>, b: Array<T>): Array<T> {
    const as = new Set(a);
    const bs = new Set(b);

    return [
        ...a.filter(x => !bs.has(x)),
        ...b.filter(x => !as.has(x))
    ];
}

export function difference<T>(a: Array<T>, b: Array<T>): Array<T> {
    const bs = new Set(b);
    return [
        ...a.filter(x => !bs.has(x)),
    ]
}

export function safeEqual(input: string, allowed: string): boolean {
    const autoReject = (input.length !== allowed.length);
    if (autoReject) {
      allowed = input;
    }
    const isMatch = crypto.timingSafeEqual(Buffer.from(input), Buffer.from(allowed));
    return (!autoReject && isMatch);
}