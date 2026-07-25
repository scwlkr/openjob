import { useState } from "react";

export function useControlInteraction() {
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);

  return {
    focused,
    hovered,
    interactionProps: {
      onBlur: () => setFocused(false),
      onFocus: () => setFocused(true),
      onHoverIn: () => setHovered(true),
      onHoverOut: () => setHovered(false),
    },
  };
}
