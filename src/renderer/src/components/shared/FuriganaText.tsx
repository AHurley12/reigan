import React from 'react'

interface Props {
  text: string
  reading: string
}

export function FuriganaText({ text, reading }: Props) {
  return (
    <ruby>
      {text}
      <rt>{reading}</rt>
    </ruby>
  )
}
