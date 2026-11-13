import React from 'react';

interface WordmarkProps {
  inverted?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function Wordmark({ inverted = false, size = 'md' }: WordmarkProps) {
  const textClass =
    size === 'lg'
      ? 'text-[34px] leading-none'
      : size === 'sm'
        ? 'text-[22px] leading-none'
        : 'text-[26px] leading-none';

  const textColor = inverted ? 'text-white' : 'text-[#1F2A2E]';
  const lineColor = inverted ? '#FFC20E' : '#0E6B4E';

  return (
    <span className="inline-flex flex-col items-start select-none" aria-label="nxtpath">
      <span className={`font-sign font-extrabold tracking-tight ${textClass} ${textColor}`}>
        nxtpath
      </span>
      <svg
        width={size === 'lg' ? 112 : size === 'sm' ? 74 : 88}
        height="6"
        viewBox="0 0 88 6"
        fill="none"
        aria-hidden="true"
        className="mt-1"
      >
        <line
          x1="1"
          y1="3"
          x2="87"
          y2="3"
          stroke={lineColor}
          strokeWidth="3"
          strokeLinecap="butt"
          strokeDasharray="12 6"
        />
      </svg>
    </span>
  );
}
