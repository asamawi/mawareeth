// Stub for next/navigation in node --test suites.
// Tests control routing by setting globalThis.__mockRouter before rendering.
export function useRouter() {
  return globalThis.__mockRouter ?? { push() {}, replace() {}, prefetch() {} };
}
export function usePathname() {
  return globalThis.__mockPathname ?? '/';
}
export function notFound() {
  const e = new Error('notFound');
  e.digest = 'NEXT_NOT_FOUND';
  throw e;
}
