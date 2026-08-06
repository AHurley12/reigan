// Runs on the dedicated audio rendering thread, not the renderer's main
// thread — unlike the ScriptProcessorNode it replaces, WebGL/render work on
// the main thread (the orb, the avatar) can no longer starve mic capture and
// cause dropped/duplicated audio buffers.
class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.chunkSize = 4096
    this.buffer = new Float32Array(this.chunkSize)
    this.bufferedLength = 0
  }

  process(inputs) {
    const channel = inputs[0]?.[0]
    if (!channel || channel.length === 0) return true

    let offset = 0
    while (offset < channel.length) {
      const spaceLeft = this.chunkSize - this.bufferedLength
      const toCopy = Math.min(spaceLeft, channel.length - offset)
      this.buffer.set(channel.subarray(offset, offset + toCopy), this.bufferedLength)
      this.bufferedLength += toCopy
      offset += toCopy

      if (this.bufferedLength === this.chunkSize) {
        this.port.postMessage(this.buffer.slice())
        this.bufferedLength = 0
      }
    }
    return true
  }
}

registerProcessor('mic-processor', MicProcessor)
