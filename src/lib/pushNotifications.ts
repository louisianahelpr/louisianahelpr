// Browser push notification utilities

export const isPushSupported = () => {
  return "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
};

export const getPushPermission = () => {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission; // "default" | "granted" | "denied"
};

export const registerServiceWorker = async (): Promise<ServiceWorkerRegistration | null> => {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.register("/sw-push.js");
    return registration;
  } catch (err) {
    console.error("SW registration failed:", err);
    return null;
  }
};

export const requestPushPermission = async (): Promise<boolean> => {
  if (!isPushSupported()) return false;
  const permission = await Notification.requestPermission();
  return permission === "granted";
};

export const showLocalNotification = (title: string, message: string, link?: string) => {
  if (Notification.permission !== "granted") return;
  
  navigator.serviceWorker.ready.then((registration) => {
    registration.showNotification(title, {
      body: message,
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      data: { link: link || "/dashboard" },
      tag: `helpr-${Date.now()}`,
    });
  });
};
