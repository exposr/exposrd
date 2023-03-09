import { EventBusService } from "../../src/eventbus/index.js";
import { StorageService } from "../../src/storage/index.js";

export const initStorageService = () => {
    return new StorageService('mem', {});
};

export const initEventBusService = () => {
    return new EventBusService('mem', {});
}