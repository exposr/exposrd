import ClusterService from "../../src/cluster/index.js";
import { StorageService } from "../../src/storage/index.js";

export const initStorageService = () => {
    return new StorageService('mem', {});
};

export const initClusterService = () => {
    return new ClusterService('mem', {});
}