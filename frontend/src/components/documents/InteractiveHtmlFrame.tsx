import { forwardRef, type IframeHTMLAttributes } from 'react'

/** Full authored pages keep their scripts and controls inside an opaque origin.
 * Never grant same-origin access: shared pages must not read the platform's session or DOM. */
export const InteractiveHtmlFrame = forwardRef<HTMLIFrameElement, Omit<IframeHTMLAttributes<HTMLIFrameElement>, 'sandbox'>>(
  function InteractiveHtmlFrame(props, ref) {
    return <iframe {...props} ref={ref} sandbox="allow-scripts allow-forms allow-popups allow-downloads" referrerPolicy="no-referrer" />
  },
)
