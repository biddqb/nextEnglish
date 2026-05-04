import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useKeyboardShortcuts, type Handlers } from "../keyboard";

// Characterization test for useKeyboardShortcuts. Step 5 will wire the
// active module's isBusy() into App.tsx's onEscape handler. This test pins
// the BEHAVIOR of the hook itself (key mapping + form-field gating) so the
// refactor doesn't accidentally change which keys reach which handlers.
//
// The Esc-priority bridge in App.tsx is layered ON TOP of this hook — that
// integration is tested in App.test.tsx (not part of step 3 because App
// imports too much; it lands in step 7 alongside the shell update).

function HookHarness({ handlers }: { handlers: Handlers }) {
  useKeyboardShortcuts(handlers);
  return <div data-testid="harness">harness</div>;
}

describe("useKeyboardShortcuts", () => {
  it("calls onEscape when Escape is pressed", async () => {
    const onEscape = vi.fn();
    render(<HookHarness handlers={{ onEscape }} />);

    await userEvent.keyboard("{Escape}");
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("calls onSegment with 0-based index for Cmd/Ctrl+1..9", async () => {
    const onSegment = vi.fn();
    render(<HookHarness handlers={{ onSegment }} />);

    await userEvent.keyboard("{Meta>}3{/Meta}");
    expect(onSegment).toHaveBeenCalledWith(2);
  });

  it("calls onShowShortcuts on `?` key (Shift+/)", async () => {
    const onShowShortcuts = vi.fn();
    render(<HookHarness handlers={{ onShowShortcuts }} />);

    await userEvent.keyboard("?");
    expect(onShowShortcuts).toHaveBeenCalledTimes(1);
  });

  it("calls onOpenSettings on Cmd/Ctrl+,", async () => {
    const onOpenSettings = vi.fn();
    render(<HookHarness handlers={{ onOpenSettings }} />);

    await userEvent.keyboard("{Meta>},{/Meta}");
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("ignores arrow keys when typing in an input field", async () => {
    const onArrowDown = vi.fn();
    function Harness() {
      useKeyboardShortcuts({ onArrowDown });
      return <input data-testid="input" />;
    }
    const { getByTestId } = render(<Harness />);

    const input = getByTestId("input") as HTMLInputElement;
    input.focus();
    await userEvent.keyboard("{ArrowDown}");

    expect(onArrowDown).not.toHaveBeenCalled();
  });

  it("still fires Escape even when focus is inside a form input", async () => {
    const onEscape = vi.fn();
    function Harness() {
      useKeyboardShortcuts({ onEscape });
      return <input data-testid="input" />;
    }
    const { getByTestId } = render(<Harness />);

    (getByTestId("input") as HTMLInputElement).focus();
    await userEvent.keyboard("{Escape}");

    expect(onEscape).toHaveBeenCalledTimes(1);
  });
});
