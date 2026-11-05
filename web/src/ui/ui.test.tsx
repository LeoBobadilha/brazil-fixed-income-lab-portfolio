import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { DataTable, Segmented } from "./kit";
import { largestMoves, rangeStart } from "../pages/common";
import { decodeHistory } from "../data/load";

const wrap = (ui: ReactNode) => render(<>{ui}</>);

describe("UI components", () => {
  it("Segmented exposes a radiogroup and reports changes", () => {
    let v = "";
    wrap(<Segmented label="Family" value="a" onChange={(x) => (v = x)} options={[{ value: "a", label: "A" }, { value: "b", label: "B" }]} />);
    expect(screen.getByRole("radio", { name: "A" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "B" }));
    expect(v).toBe("b");
  });

  it("DataTable rows are keyboard-selectable", () => {
    let picked = "";
    wrap(
      <DataTable caption="t" rowKey={(r: { k: string }) => r.k} rows={[{ k: "x" }, { k: "y" }]} onRowClick={(r) => (picked = r.k)}
        columns={[{ key: "k", label: "K", render: (r) => r.k }]} />,
    );
    const row = screen.getByText("y").closest("tr")!;
    fireEvent.keyDown(row, { key: "Enter" });
    expect(picked).toBe("y");
  });
});

describe("data helpers", () => {
  it("decodes integer-encoded history", () => {
    const h = decodeHistory({ id: "X", d: [0, 1], br: [728, null], sr: [740, 741], bp: [17894, 17900], sp: [16996, 17000], mac: [45626, null], mod: [42530, null], cvx: [18744, null], dv01: [7610, null] });
    expect(h.dates).toEqual(["2000-01-01", "2000-01-02"]);
    expect(h.buyRate).toEqual([7.28, null]);
    expect(h.buyPrice[0]).toBeCloseTo(178.94, 10);
    expect(h.modified[0]).toBeCloseTo(42.53, 10);
  });

  it("rangeStart and largestMoves", () => {
    const dates = ["2020-01-01", "2021-01-01", "2022-01-01", "2023-01-01"];
    expect(rangeStart(dates, 1)).toBe(2);
    expect(rangeStart(dates, null)).toBe(0);
    const moves = largestMoves(["a", "b", "c", "d", "e"], [1, 1, 3, 3, 0], 1, 2);
    expect(moves[0].change).toBeCloseTo(-300);
    expect(moves[1].change).toBeCloseTo(200);
  });
});

describe("number formatting", () => {
  it("never renders a negative zero", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { useFmt } = await import("../format");
    const { result } = renderHook(() => useFmt());
    expect(result.current.brl(-0)).toBe("R$ 0.00");
    expect(result.current.brl(-0.001)).toBe("R$ 0.00");
    expect(result.current.num(-0.04, 1)).toBe("0.0");
    expect(result.current.brl(-714.48)).toBe("R$ -714.48");
  });
});
