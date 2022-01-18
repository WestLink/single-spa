import {
  validLifecycleFn,
  flattenFnArray,
} from "../lifecycles/lifecycle.helpers.js";
import {
  NOT_BOOTSTRAPPED,
  NOT_MOUNTED,
  MOUNTED,
  LOADING_SOURCE_CODE,
  SKIP_BECAUSE_BROKEN,
  toName,
} from "../applications/app.helpers.js";
import { toBootstrapPromise } from "../lifecycles/bootstrap.js";
import { toMountPromise } from "../lifecycles/mount.js";
import { toUpdatePromise } from "../lifecycles/update.js";
import { toUnmountPromise } from "../lifecycles/unmount.js";
import { ensureValidAppTimeouts } from "../applications/timeouts.js";
import { formatErrorMessage } from "../applications/app-errors.js";

let parcelCount = 0;
const rootParcels = { parcels: {} };

// This is a public api, exported to users of single-spa
export function mountRootParcel() {
  return mountParcel.apply(rootParcels, arguments);
}

export function mountParcel(config, customProps) {
  const owningAppOrParcel = this;

  // Validate inputs
  if (!config || (typeof config !== "object" && typeof config !== "function")) {
    // 不是所期望的配置形态
    throw Error(
      formatErrorMessage(
        2,
        __DEV__ &&
          "Cannot mount parcel without a config object or config loading function"
      )
    );
  }

  if (config.name && typeof config.name !== "string") {
    // TODO 为啥必须要求是字符串？
    throw Error(
      formatErrorMessage(
        3,
        __DEV__ &&
          `Parcel name must be a string, if provided. Was given ${typeof config.name}`,
        typeof config.name
      )
    );
  }

  if (typeof customProps !== "object") {
    // 自定义属性到这里必须是对象，提供的时候可以是一个生成器
    throw Error(
      formatErrorMessage(
        4,
        __DEV__ &&
          `Parcel ${name} has invalid customProps -- must be an object but was given ${typeof customProps}`,
        name,
        typeof customProps
      )
    );
  }

  if (!customProps.domElement) {
    // TODO 这里提供dom元素是干啥用的？
    throw Error(
      formatErrorMessage(
        5,
        __DEV__ &&
          `Parcel ${name} cannot be mounted without a domElement provided as a prop`,
        name
      )
    );
  }

  const id = parcelCount++;

  const passedConfigLoadingFunction = typeof config === "function";
  const configLoadingFunction = passedConfigLoadingFunction
    ? config
    : () => Promise.resolve(config);

  // Internal representation
  const parcel = {
    id,
    parcels: {},
    status: passedConfigLoadingFunction // 如果配置对象是个函数，则状态设置为正在加载代码，否则设置为未启动
      ? LOADING_SOURCE_CODE
      : NOT_BOOTSTRAPPED,
    customProps,
    parentName: toName(owningAppOrParcel), // 上层包的名称，TODO 难道支持应用形成树状的结构？
    unmountThisParcel() {
      // 提供卸载的能力
      return mountPromise
        .then(() => {
          // 说明已经尝试装载过
          if (parcel.status !== MOUNTED) {
            // 但是没成功
            throw Error(
              formatErrorMessage(
                6,
                __DEV__ &&
                  `Cannot unmount parcel '${name}' -- it is in a ${parcel.status} status`,
                name,
                parcel.status
              )
            );
          }
          return toUnmountPromise(parcel, true);
        })
        .then((value) => {
          if (parcel.parentName) {
            // 卸载成功后从子包中删除
            delete owningAppOrParcel.parcels[parcel.id];
          }

          return value;
        })
        .then((value) => {
          resolveUnmount(value); // 通知卸载消息的订阅者
          return value;
        })
        .catch((err) => {
          // TODO 这个catch的是谁？
          parcel.status = SKIP_BECAUSE_BROKEN;
          rejectUnmount(err);
          throw err;
        });
    },
  };

  // We return an external representation
  let externalRepresentation;

  // Add to owning app or parcel
  owningAppOrParcel.parcels[id] = parcel;

  let loadPromise = configLoadingFunction();

  if (!loadPromise || typeof loadPromise.then !== "function") {
    throw Error(
      formatErrorMessage(
        7,
        __DEV__ &&
          `When mounting a parcel, the config loading function must return a promise that resolves with the parcel config`
      )
    );
  }

  loadPromise = loadPromise.then((config) => {
    if (!config) {
      throw Error(
        formatErrorMessage(
          8,
          __DEV__ &&
            `When mounting a parcel, the config loading function returned a promise that did not resolve with a parcel config`
        )
      );
    }

    const name = config.name || `parcel-${id}`;

    if (
      // ES Module objects don't have the object prototype
      Object.prototype.hasOwnProperty.call(config, "bootstrap") &&
      !validLifecycleFn(config.bootstrap)
    ) {
      throw Error(
        formatErrorMessage(
          9,
          __DEV__ && `Parcel ${name} provided an invalid bootstrap function`,
          name
        )
      );
    }

    if (!validLifecycleFn(config.mount)) {
      throw Error(
        formatErrorMessage(
          10,
          __DEV__ && `Parcel ${name} must have a valid mount function`,
          name
        )
      );
    }

    if (!validLifecycleFn(config.unmount)) {
      throw Error(
        formatErrorMessage(
          11,
          __DEV__ && `Parcel ${name} must have a valid unmount function`,
          name
        )
      );
    }

    if (config.update && !validLifecycleFn(config.update)) {
      throw Error(
        formatErrorMessage(
          12,
          __DEV__ && `Parcel ${name} provided an invalid update function`,
          name
        )
      );
    }

    const bootstrap = flattenFnArray(config, "bootstrap");
    const mount = flattenFnArray(config, "mount");
    const unmount = flattenFnArray(config, "unmount");

    parcel.status = NOT_BOOTSTRAPPED;
    parcel.name = name;
    parcel.bootstrap = bootstrap;
    parcel.mount = mount;
    parcel.unmount = unmount;
    parcel.timeouts = ensureValidAppTimeouts(config.timeouts);

    if (config.update) {
      parcel.update = flattenFnArray(config, "update");
      // 更新的生命周期函数转换为无需返回Promised的
      externalRepresentation.update = function (customProps) {
        parcel.customProps = customProps;

        return promiseWithoutReturnValue(toUpdatePromise(parcel));
      };
    }
  });

  // Start bootstrapping and mounting
  // The .then() causes the work to be put on the event loop instead of happening immediately
  const bootstrapPromise = loadPromise.then(() =>
    toBootstrapPromise(parcel, true)
  );
  const mountPromise = bootstrapPromise.then(() =>
    toMountPromise(parcel, true)
  );

  let resolveUnmount, rejectUnmount;

  const unmountPromise = new Promise((resolve, reject) => {
    resolveUnmount = resolve;
    rejectUnmount = reject;
  });

  externalRepresentation = {
    mount() {
      return promiseWithoutReturnValue(
        Promise.resolve().then(() => {
          if (parcel.status !== NOT_MOUNTED) {
            throw Error(
              formatErrorMessage(
                13,
                __DEV__ &&
                  `Cannot mount parcel '${name}' -- it is in a ${parcel.status} status`,
                name,
                parcel.status
              )
            );
          }

          // Add to owning app or parcel
          owningAppOrParcel.parcels[id] = parcel;

          return toMountPromise(parcel);
        })
      );
    },
    unmount() {
      return promiseWithoutReturnValue(parcel.unmountThisParcel());
    },
    getStatus() {
      return parcel.status;
    },
    loadPromise: promiseWithoutReturnValue(loadPromise),
    bootstrapPromise: promiseWithoutReturnValue(bootstrapPromise),
    mountPromise: promiseWithoutReturnValue(mountPromise),
    unmountPromise: promiseWithoutReturnValue(unmountPromise),
  };

  return externalRepresentation;
}

function promiseWithoutReturnValue(promise) {
  return promise.then(() => null);
}
