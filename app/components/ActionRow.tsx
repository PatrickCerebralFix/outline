import { transparentize } from "polished";
import styled from "styled-components";
import breakpoint from "styled-components-breakpoint";
import { s } from "@shared/styles";
import { HStack } from "~/components/primitives/HStack";

/**
 * A sticky container for primary page actions.
 */
export const ActionRow = styled(HStack).attrs({
  spacing: 8,
})`
  position: sticky;
  bottom: 0;
  z-index: 1;
  width: 100vw;
  padding: 16px 12px;
  margin-left: -12px;
  border-top: 1px solid ${s("divider")};
  background: ${s("background")};
  background-clip: padding-box;
  box-shadow: 0 -8px 24px ${transparentize(0.94, "#000")};

  @supports (backdrop-filter: blur(20px)) {
    backdrop-filter: blur(20px);
    background: ${(props) => transparentize(0.08, props.theme.background)};
  }

  ${breakpoint("tablet")`
    width: auto;
    margin-left: 0;
    border-radius: 8px;
    border: 1px solid ${s("divider")};
  `}
`;
