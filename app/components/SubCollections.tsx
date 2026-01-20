import { observer } from "mobx-react";
import { PlusIcon } from "outline-icons";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import breakpoint from "styled-components-breakpoint";
import type Collection from "~/models/Collection";
import useStores from "~/hooks/useStores";
import { CollectionNew } from "~/components/Collection/CollectionNew";
import CollectionCard from "~/components/CollectionCard";
import { ResizingHeightContainer } from "./ResizingHeightContainer";
import NudeButton from "./NudeButton";
import Flex from "./Flex";
import Text from "./Text";

type Props = {
  /** The parent collection */
  collection: Collection;
  /** Whether the user can create child collections */
  canCreateChildCollection?: boolean;
};

/**
 * A component that displays child collections in a grid layout with an optional
 * button to create new sub-collections.
 *
 * @param props - the component props.
 * @returns the rendered component.
 */
function SubCollections({ collection, canCreateChildCollection }: Props) {
  const { t } = useTranslation();
  const { dialogs } = useStores();
  const childCollections = collection.childCollections;

  if (childCollections.length === 0 && !canCreateChildCollection) {
    return null;
  }

  const handleNewSubCollection = () => {
    dialogs.openModal({
      title: t("New sub-collection"),
      content: (
        <CollectionNew
          parentCollectionId={collection.id}
          onSubmit={dialogs.closeAllModals}
        />
      ),
    });
  };

  return (
    <ResizingHeightContainer>
      <Section>
        <Header align="center" justify="space-between">
          <Text type="secondary" weight="bold" size="small">
            {t("Sub-collections")}
          </Text>
          {canCreateChildCollection && (
            <NudeButton
              onClick={handleNewSubCollection}
              aria-label={t("New sub-collection")}
            >
              <PlusIcon />
            </NudeButton>
          )}
        </Header>
        {childCollections.length > 0 && (
          <List>
            {childCollections.map((child) => (
              <CollectionCard key={child.id} collection={child} />
            ))}
          </List>
        )}
      </Section>
    </ResizingHeightContainer>
  );
}

const Section = styled.div`
  margin-bottom: 24px;
`;

const Header = styled(Flex)`
  margin-bottom: 12px;
`;

const List = styled.div`
  display: grid;
  column-gap: 8px;
  row-gap: 12px;
  grid-template-columns: repeat(2, minmax(0, 1fr));

  ${breakpoint("mobileLarge")`
    grid-template-columns: repeat(3, minmax(0, 1fr));
  `};

  ${breakpoint("tablet")`
    grid-template-columns: repeat(4, minmax(0, 1fr));
  `};
`;

export default observer(SubCollections);
