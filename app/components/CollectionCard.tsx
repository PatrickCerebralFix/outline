import { observer } from "mobx-react";
import { Link } from "react-router-dom";
import styled from "styled-components";
import { s, hover, ellipsis } from "@shared/styles";
import type Collection from "~/models/Collection";
import CollectionIcon from "~/components/Icons/CollectionIcon";
import Flex from "~/components/Flex";

type Props = {
  /** The collection to display */
  collection: Collection;
};

/**
 * A card component for displaying a collection in a grid layout.
 *
 * @param props - the component props.
 * @returns the rendered component.
 */
function CollectionCard({ collection }: Props) {
  return (
    <CollectionLink to={collection.path}>
      <IconWrapper style={{ background: collection.color ?? undefined }}>
        <CollectionIcon collection={collection} color="white" size={20} />
      </IconWrapper>
      <Name>{collection.name}</Name>
    </CollectionLink>
  );
}

const CollectionLink = styled(Link)`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: var(--pointer);
  background: ${s("secondaryBackground")};
  border: 1px solid transparent;
  transition: background 100ms ease-in-out, border-color 100ms ease-in-out;

  &:${hover},
  &:active,
  &:focus {
    background: ${s("sidebarControlHoverBackground")};
    border-color: ${s("inputBorder")};
  }
`;

const IconWrapper = styled(Flex)`
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: ${s("accent")};
`;

const Name = styled.span`
  ${ellipsis()}
  color: ${s("text")};
  font-size: 14px;
  font-weight: 500;
`;

export default observer(CollectionCard);
