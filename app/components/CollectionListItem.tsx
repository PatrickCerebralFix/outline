import {
  useFocusEffect,
  useRovingTabIndex,
} from "@getoutline/react-roving-tabindex";
import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import styled from "styled-components";
import breakpoint from "styled-components-breakpoint";
import { s, hover } from "@shared/styles";
import type Collection from "~/models/Collection";
import CollectionIcon from "~/components/Icons/CollectionIcon";
import Flex from "~/components/Flex";
import Highlight from "~/components/Highlight";
import Text from "~/components/Text";
import { collectionPath } from "~/utils/routeHelpers";

type Props = {
  /** The collection to display. */
  collection: Collection;
  /** Optional search term to highlight in the collection name. */
  highlight?: string;
};

function CollectionListItem(
  props: Props,
  ref: React.RefObject<HTMLAnchorElement>
) {
  const { t } = useTranslation();
  const { collection, highlight } = props;

  let itemRef: React.Ref<HTMLAnchorElement> =
    React.useRef<HTMLAnchorElement>(null);
  if (ref) {
    itemRef = ref;
  }

  const { focused, ...rovingTabIndex } = useRovingTabIndex(itemRef, false);
  useFocusEffect(focused, itemRef);

  return (
    <CollectionLink
      ref={itemRef}
      to={{
        pathname: collectionPath(collection),
        state: {
          title: collection.name,
        },
      }}
      {...rovingTabIndex}
    >
      <Flex gap={4} auto>
        <IconWrapper>
          <CollectionIcon collection={collection} />
        </IconWrapper>
        <Content>
          <Heading>
            <Title text={collection.name} highlight={highlight} />
          </Heading>
          <Meta type="tertiary" size="small">
            {t("Collection")}
            {collection.parentCollection && (
              <>
                {" "}
                {t("in")} {collection.parentCollection.name}
              </>
            )}
          </Meta>
        </Content>
      </Flex>
    </CollectionLink>
  );
}

const IconWrapper = styled.div`
  flex-shrink: 0;
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  width: 24px;
`;

const Content = styled.div`
  flex-grow: 1;
  flex-shrink: 1;
  min-width: 0;
`;

const CollectionLink = styled(Link)`
  display: flex;
  align-items: center;
  margin: 10px -8px;
  padding: 6px 8px;
  border-radius: 8px;
  max-height: 50vh;
  width: calc(100vw - 8px);
  cursor: var(--pointer);

  &:focus-visible {
    outline: none;
  }

  ${breakpoint("tablet")`
    width: auto;
  `};

  &:${hover},
  &:active,
  &:focus,
  &:focus-within {
    background: ${s("listItemHoverBackground")};
  }
`;

const Heading = styled.span`
  display: flex;
  align-items: center;
  margin-top: 0;
  margin-bottom: 0.1em;
  white-space: nowrap;
  color: ${s("text")};
  font-family: ${s("fontFamily")};
  font-weight: 500;
  font-size: 18px;
  line-height: 1.2;
  gap: 4px;
`;

const Title = styled(Highlight)`
  max-width: 90%;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Meta = styled(Text)`
  margin: 0;
`;

export default observer(React.forwardRef(CollectionListItem));
