type LogoMarkProps = {
  className?: string
  bubbleColor: string
}

export function LogoMark({ className, bubbleColor }: LogoMarkProps) {
  return (
    <svg
      width="601"
      height="606"
      viewBox="0 0 601 606"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <g clipPath="url(#clip0_21_2)">
        <circle cx="285.5" cy="177.5" r="138" stroke="black" strokeWidth="43" strokeLinecap="round" />
        <path
          d="M397.426 91.0659C475 66.736 383.062 42.4371 455 46.434M220.911 318.888C113.435 375.146 106.051 431.875 120.62 472.768C146.009 544.029 275.752 567.204 302.95 456.007C307.622 436.906 325.089 421.676 343.826 427.639C480.541 471.143 410.331 618.876 307.793 570.692"
          stroke="black"
          strokeWidth="40"
          strokeLinecap="round"
        />
        <circle cx="392" cy="110" r="24" fill={bubbleColor} />
      </g>
      <defs>
        <clipPath id="clip0_21_2">
          <rect width="601" height="606" fill="white" />
        </clipPath>
      </defs>
    </svg>
  )
}
