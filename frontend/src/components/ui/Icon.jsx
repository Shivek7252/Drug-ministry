import React from 'react';
import ICONS from './iconPaths';

/* ============================================================================
   <Icon name="search" />

   Monochrome, 20px by default, always inherits the surrounding text colour.
   Decorative by default (aria-hidden). Pass `title` only when the icon is the
   sole carrier of meaning — in that case it becomes an img with a label.
   ============================================================================ */

export default function Icon({
  name,
  size = 20,
  strokeWidth = 1.75,
  title,
  className = '',
  ...rest
}) {
  const d = ICONS[name];
  if (!d) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`<Icon> unknown name: "${name}"`);
    }
    return null;
  }

  const labelled = Boolean(title);

  return (
    <svg
      className={`ui-icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? title : undefined}
      aria-hidden={labelled ? undefined : 'true'}
      focusable="false"
      {...rest}
    >
      {labelled && <title>{title}</title>}
      {d.split('|').map((segment, i) => <path key={i} d={segment} />)}
    </svg>
  );
}
