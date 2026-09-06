// A timeout bounds waiting, not the underlying operation. Never use it as
// evidence that a mutating command did not execute.
export async function withTimeout<T>(operation: Promise<T>, milliseconds: number, detail: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(detail)), milliseconds);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
