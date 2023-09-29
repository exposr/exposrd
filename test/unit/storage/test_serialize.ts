import assert from 'assert/strict';
import Serializer, { Serializable } from '../../../src/storage/serializer.js'

type Sub = {
    astring?: string;
    anarray?: Array<number>;
}

class Test implements Serializable {
    public astring?: string = undefined;
    public anumber?: number = undefined;
    public obj?: Sub = {
        astring: undefined,
        anarray: [],
    };
    public anarray?: Array<string> = [];
}

describe('Serializer', () => {

    it(`Can serialize/deserialize`, () => {
        const test: Test = {
            anumber: 10
        }

        let str = Serializer.serialize(test)
        assert(str == '{"anumber":10}')

        let test2 = Serializer.deserialize<Test>(str, Test);
        assert(test2.anumber == 10);
    });

    it(`Nested objects`, () => {
        const test: Test = {
            anumber: 10,
            obj: {
                astring: "foo"
            }
        }

        let str = Serializer.serialize(test)
        assert(str == '{"anumber":10,"obj":{"astring":"foo"}}')

        let test2 = Serializer.deserialize<Test>(str, Test);
        assert(test2.obj?.astring == 'foo');
    });

    it(`Array`, () => {
        const test: Test = {
            anumber: 10,
            anarray: [
                "bar"
            ]
        }

        let str = Serializer.serialize(test)
        assert(str == '{"anumber":10,"anarray":["bar"]}');

        let test2 = Serializer.deserialize<Test>(str, Test);
        assert(test2?.anarray?.[0] == 'bar');
    });

    it(`Nested array`, () => {
        const test: Test = {
            anumber: 10,
            obj: {
                anarray: [1,2]
            }
        }

        let str = Serializer.serialize(test)
        assert(str == '{"anumber":10,"obj":{"anarray":[1,2]}}');

        let test2 = Serializer.deserialize<Test>(str, Test);
        assert(test2?.obj?.anarray?.[0] == 1);
        assert(test2?.obj?.anarray?.[1] == 2);
    });

});