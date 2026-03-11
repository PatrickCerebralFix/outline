import { observer } from "mobx-react";
import { useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import type { NavigationNode } from "@shared/types";
import type Document from "~/models/Document";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import Text from "~/components/Text";
import useCollectionTrees from "~/hooks/useCollectionTrees";
import useStores from "~/hooks/useStores";
import { FlexContainer, Footer } from "./Components";
import DocumentExplorer from "./DocumentExplorer";

type Props = {
  document: Document;
};

function DocumentMove({ document }: Props) {
  const { dialogs, documents, policies } = useStores();
  const { t } = useTranslation();
  const collectionTrees = useCollectionTrees();
  const [moving, setMoving] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [selectedPath, selectPath] = useState<NavigationNode | null>(null);
  const [droppedPropertyNames, setDroppedPropertyNames] = useState<string[]>([]);
  const [attachCandidates, setAttachCandidates] = useState<string[]>([]);
  const [canAttachToDestination, setCanAttachToDestination] = useState(false);
  const [attachMissingProperties, setAttachMissingProperties] = useState(true);

  const items = useMemo(() => {
    const filterSourceDocument = (node: NavigationNode): NavigationNode => ({
      ...node,
      children: node.children
        ?.filter(
          (child) => child.id !== document.id && child.id !== document.parentDocumentId
        )
        .map(filterSourceDocument),
    });

    const nodes = collectionTrees
      .map(filterSourceDocument)
      .filter((node) =>
        node.collectionId
          ? policies.get(node.collectionId)?.abilities.createDocument
          : true
      );

    if (document.isTemplate) {
      return nodes
        .filter((node) => node.type === "collection")
        .map((node) => ({ ...node, children: [] }));
    }

    return nodes;
  }, [
    collectionTrees,
    document.id,
    document.isTemplate,
    document.parentDocumentId,
    policies,
  ]);

  useEffect(() => {
    if (!selectedPath) {
      setDroppedPropertyNames([]);
      setAttachCandidates([]);
      setCanAttachToDestination(false);
      setAttachMissingProperties(true);
      return;
    }

    let cancelled = false;

    const loadPreview = async () => {
      setPreviewLoading(true);

      try {
        const preview = await documents.movePreview({
          documentId: document.id,
          collectionId: selectedPath.collectionId as string,
          parentDocumentId:
            selectedPath.type === "document" ? selectedPath.id : null,
        });

        if (cancelled) {
          return;
        }

        setDroppedPropertyNames(preview.droppedPropertyNames);
        setAttachCandidates(preview.attachCandidates);
        setCanAttachToDestination(preview.canAttachToDestination);
        setAttachMissingProperties(preview.canAttachToDestination);
      } catch (err) {
        if (!cancelled) {
          toast.error((err as Error).message);
        }
      } finally {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      }
    };

    void loadPreview();

    return () => {
      cancelled = true;
    };
  }, [document.id, documents, selectedPath]);

  const handleMove = async () => {
    if (!selectedPath) {
      toast.message(t("Select a location to move"));
      return;
    }

    try {
      setMoving(true);
      await documents.move({
        documentId: document.id,
        collectionId: selectedPath.collectionId as string,
        parentDocumentId:
          selectedPath.type === "document" ? selectedPath.id : undefined,
        confirmPropertyDrops: true,
        attachPropertyDefinitionIds:
          attachMissingProperties && canAttachToDestination
            ? attachCandidates
            : undefined,
      });
      toast.success(t("Document moved"));
      dialogs.closeAllModals();
    } catch (_err) {
      toast.error(t("Couldn’t move the document, try again?"));
    } finally {
      setMoving(false);
    }
  };

  return (
    <FlexContainer column>
      <DocumentExplorer
        items={items}
        onSubmit={handleMove}
        onSelect={selectPath}
      />
      <Footer justify="space-between" align="center" gap={8}>
        <FooterText column gap={4}>
          <Text ellipsis type="secondary">
            {selectedPath ? (
              <Trans
                defaults="Move to <em>{{ location }}</em>"
                values={{
                  location: selectedPath.title || t("Untitled"),
                }}
                components={{
                  em: <strong />,
                }}
              />
            ) : (
              t("Select a location to move")
            )}
          </Text>
          {!!selectedPath && droppedPropertyNames.length > 0 && (
            <>
              <Text type="secondary" size="small">
                {t("This move will remove:")} {droppedPropertyNames.join(", ")}
              </Text>
              {canAttachToDestination && attachCandidates.length > 0 && (
                <CheckboxRow align="center" gap={8}>
                  <input
                    id="attach-missing-properties"
                    type="checkbox"
                    checked={attachMissingProperties}
                    onChange={(ev) =>
                      setAttachMissingProperties(ev.target.checked)
                    }
                  />
                  <label htmlFor="attach-missing-properties">
                    {t("Also add those properties to the destination collection")}
                  </label>
                </CheckboxRow>
              )}
            </>
          )}
        </FooterText>
        <Button
          disabled={!selectedPath || moving || previewLoading}
          onClick={handleMove}
        >
          {moving
            ? `${t("Moving")}…`
            : previewLoading
              ? `${t("Loading")}…`
              : t("Move")}
        </Button>
      </Footer>
    </FlexContainer>
  );
}

const FooterText = styled(Flex)`
  min-width: 0;
`;

const CheckboxRow = styled(Flex)`
  font-size: 13px;
`;

export default observer(DocumentMove);
