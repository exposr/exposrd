class Serializer {

    static serialize(object) {
        const clazz = object.constructor.name;
        object = {
            __class__: clazz,
            ...object
        };
        return JSON.stringify(object, (key, value) => {
            if (key[0] == '_' && key != '__class__') {
                return undefined;
            }
            return value;
        });
    }

    static deserialize(json, clazz) {
        const obj = JSON.parse(json) || {};
        if (obj.__class__ != clazz.name) {
            return undefined;
        }
        delete obj['__class__'];

        const merge = (target, source) => {
            for (const key of Object.keys(target)) {
                if (target[key] instanceof Object && source[key] instanceof Object) {
                    Object.assign(target[key], merge(target[key], source[key]));
                } else if (source[key] != undefined) {
                    target[key] = source[key];
                }
            }

            return target;
        }

        const canonicalObj = Object.assign(new clazz(), {
            ...merge(new clazz(), obj)
        });
        // Run migration hooks
        typeof canonicalObj._deserialization_hook === 'function' &&
            canonicalObj._deserialization_hook();
        return canonicalObj;
    }

}

export default Serializer;