export interface Serializable {}

export default class Serializer {

    static serialize(object: Serializable): string {
        return JSON.stringify(object, (key, value) => {
            if (key[0] == '_') {
                return undefined;
            }
            return value;
        });
    }

    static deserialize<Type>(json: string | object, type:  { new(): Type ;} ): Type {
        const obj = typeof json == 'object' ? json : JSON.parse(json) || {};

        const merge = (target: any, source: any): Type => {
            for (const key of Object.keys(target)) {
                if (target[key] instanceof Array && source[key] instanceof Array) {
                    target[key] = source[key];
                } else if (target[key] instanceof Object && source[key] instanceof Object) {
                    Object.assign(target[key], merge(target[key], source[key]));
                } else if (source[key] != undefined) {
                    target[key] = source[key];
                }
            }

            return target;
        }

        const canonicalObj = Object.assign(<any>new type(), {
            ...merge(new type(), obj as Type)
        }) as Type;

        return canonicalObj;
    }

}