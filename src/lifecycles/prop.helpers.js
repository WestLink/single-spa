import * as singleSpa from "../single-spa.js";
import { mountParcel } from "../parcels/mount-parcel.js";
import { assign } from "../utils/assign.js";
import { isParcel, toName } from "../applications/app.helpers.js";
import { formatErrorMessage } from "../applications/app-errors.js";

export function getProps(appOrParcel) {
  const name = toName(appOrParcel);
  // 解析自定义属性，要求必须是对象
  let customProps =
    typeof appOrParcel.customProps === "function"
      ? appOrParcel.customProps(name, window.location)
      : appOrParcel.customProps;
  if (
    typeof customProps !== "object" ||
    customProps === null ||
    Array.isArray(customProps)
  ) {
    customProps = {};
    console.warn(
      formatErrorMessage(
        40,
        __DEV__ &&
          `single-spa: ${name}'s customProps function must return an object. Received ${customProps}`
      ),
      name,
      customProps
    );
  }
  // 合成最终的属性
  const result = assign({}, customProps, {
    name,
    mountParcel: mountParcel.bind(appOrParcel),
    singleSpa, // 把整体能力也作为属性暴露出去了
  });

  if (isParcel(appOrParcel)) {
    result.unmountSelf = appOrParcel.unmountThisParcel;
  }

  return result;
}
