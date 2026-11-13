// Stub for next/link in node --test suites.
import { createElement } from 'react';
export default function Link({ href, children, ...rest }) {
  return createElement('a', { href, ...rest }, children);
}
