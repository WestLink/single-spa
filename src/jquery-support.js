import { routingEventsListeningTo } from "./navigation/navigation-events.js";

let hasInitialized = false;

export function ensureJQuerySupport(jQuery = window.jQuery) {
  if (!jQuery) {
    if (window.$ && window.$.fn && window.$.fn.jquery) {
      jQuery = window.$;
    }
  }

  if (jQuery && !hasInitialized) {
    const originalJQueryOn = jQuery.fn.on;
    const originalJQueryOff = jQuery.fn.off;

    // 拦截jQuery对事件处理函数
    jQuery.fn.on = function (eventString, fn) {
      return captureRoutingEvents.call(
        this,
        originalJQueryOn,
        window.addEventListener,
        eventString,
        fn,
        arguments
      );
    };

    jQuery.fn.off = function (eventString, fn) {
      return captureRoutingEvents.call(
        this,
        originalJQueryOff,
        window.removeEventListener,
        eventString,
        fn,
        arguments
      );
    };

    hasInitialized = true;
  }
}

function captureRoutingEvents(
  originalJQueryFunction,
  nativeFunctionToCall,
  eventString,
  fn,
  originalArgs
) {
  if (typeof eventString !== "string") {
    return originalJQueryFunction.apply(this, originalArgs);
  }

  const eventNames = eventString.split(/\s+/);
  eventNames.forEach((eventName) => {
    if (routingEventsListeningTo.indexOf(eventName) >= 0) {
      // 如果是路由事件
      // 让window自带事件函数去处理(PS：这可能是为了防止其他应用处理路由的情况)
      nativeFunctionToCall(eventName, fn);
      // 从要监听的事件列表中移除
      eventString = eventString.replace(eventName, "");
    }
  });

  if (eventString.trim() === "") {
    return this;
  } else {
    // 还有其他需要处理的事件，让jQuery去处理
    return originalJQueryFunction.apply(this, originalArgs);
  }
}
