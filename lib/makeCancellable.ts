export interface Cancellable<R> {
  promise: Promise<R>;
  cancel: () => void;
}

export default function makeCancellable<R>(promise: Promise<R>): Cancellable<R> {
  let hasCanceled = false;

  const wrappedPromise = new Promise<R>((resolve, reject) => {
    promise
      .then(val => (hasCanceled ? reject(new Error('canceled')) : resolve(val)))
      .catch(error => (hasCanceled ? reject(new Error('canceled')) : reject(error)));
  });

  return {
    promise: wrappedPromise,
    cancel: () => {
      hasCanceled = true;
    },
  };
}
