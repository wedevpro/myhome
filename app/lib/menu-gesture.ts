type MenuPointer = {
  pointerId: number
  pointerType: string
  isPrimary: boolean
  clientX: number
  clientY: number
}

/** Tracks a touch tap without cancelling the browser's scrolling gesture. */
export class TouchMenuGesture {
  private pointer: { id: number; x: number; y: number; moved: boolean } | null = null
  private click: "none" | "tap" | "blocked" = "none"

  constructor(private readonly tolerance = 8) {}

  start(event: MenuPointer): boolean {
    if (event.pointerType !== "touch") {
      this.reset()
      return false
    }
    if (!event.isPrimary || this.pointer) {
      this.cancel()
      return false
    }
    this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
    this.click = "blocked"
    return true
  }

  move(event: Pick<MenuPointer, "pointerId" | "clientX" | "clientY">): void {
    if (!this.pointer || event.pointerId !== this.pointer.id) return
    const dx = event.clientX - this.pointer.x
    const dy = event.clientY - this.pointer.y
    if (dx * dx + dy * dy > this.tolerance * this.tolerance) this.pointer.moved = true
  }

  end(event: Pick<MenuPointer, "pointerId" | "clientX" | "clientY">): boolean {
    if (!this.pointer || event.pointerId !== this.pointer.id) return false
    this.move(event)
    this.click = this.pointer.moved ? "blocked" : "tap"
    this.pointer = null
    return true
  }

  cancel(): void {
    this.pointer = null
    this.click = "blocked"
  }

  reset(): void {
    this.pointer = null
    this.click = "none"
  }

  consumeClick(detail: number, pointerType = ""): boolean {
    // Radix already opens mouse/pen menus on pointerdown. Pointerless clicks
    // (keyboard and assistive technologies) must remain available after a drag.
    const activate = pointerType === "mouse" || pointerType === "pen"
      ? false
      : pointerType !== "touch" && detail === 0
        ? true
        : this.click === "tap"
    this.reset()
    return activate
  }
}
