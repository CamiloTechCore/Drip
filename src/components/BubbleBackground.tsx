/** Decorative, pointer-safe bubbles that rise from the bottom edge. */
export default function BubbleBackground() {
  return (
    <div className="bubble-background" aria-hidden="true">
      {Array.from({ length: 24 }, (_, index) => <span key={index} />)}
    </div>
  );
}
