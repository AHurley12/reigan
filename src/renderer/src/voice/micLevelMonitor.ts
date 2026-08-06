/**
 * Feeds an existing mic MediaStream into an AnalyserNode and reports RMS
 * amplitude (0-1) on every animation frame — used for the Settings level
 * meter shown while testing a selected input device.
 */
export function startLevelMonitor(stream: MediaStream, onLevel: (level: number) => void): () => void {
  const ctx = new AudioContext()
  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  source.connect(analyser)

  const data = new Uint8Array(analyser.frequencyBinCount)
  let raf = 0

  const tick = () => {
    analyser.getByteTimeDomainData(data)
    let sumSquares = 0
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128
      sumSquares += v * v
    }
    onLevel(Math.sqrt(sumSquares / data.length))
    raf = requestAnimationFrame(tick)
  }
  tick()

  return () => {
    cancelAnimationFrame(raf)
    source.disconnect()
    analyser.disconnect()
    ctx.close()
  }
}
