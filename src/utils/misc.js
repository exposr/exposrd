export function symDifference(a, b) {
    const as = new Set(a);
    const bs = new Set(b);

    return [
        ...a.filter(x => !bs.has(x)),
        ...b.filter(x => !as.has(x))
    ];
}

export function difference(a, b) {
    const bs = new Set(b);
    return [
        ...a.filter(x => !bs.has(x)),
    ]
}