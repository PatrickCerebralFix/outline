import { observer } from "mobx-react";
import { v4 as uuidv4 } from "uuid";
import queryString from "query-string";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useHistory, useLocation, useRouteMatch } from "react-router-dom";
import { Waypoint } from "react-waypoint";
import styled from "styled-components";
import breakpoint from "styled-components-breakpoint";
import { Pagination } from "@shared/constants";
import type {
  SortFilter as TSortFilter,
  DirectionFilter as TDirectionFilter,
  DateFilter as TDateFilter,
} from "@shared/types";
import {
  DocumentPropertyFilterOperator as TDocumentPropertyFilterOperator,
  DocumentPropertyType as TDocumentPropertyType,
  StatusFilter as TStatusFilter,
} from "@shared/types";
import ArrowKeyNavigation from "~/components/ArrowKeyNavigation";
import CollectionListItem from "~/components/CollectionListItem";
import DocumentListItem from "~/components/DocumentListItem";
import Fade from "~/components/Fade";
import Flex from "~/components/Flex";
import LoadingIndicator from "~/components/LoadingIndicator";
import RegisterKeyDown from "~/components/RegisterKeyDown";
import Scene from "~/components/Scene";
import Switch from "~/components/Switch";
import Text from "~/components/Text";
import env from "~/env";
import type Collection from "~/models/Collection";
import usePaginatedRequest from "~/hooks/usePaginatedRequest";
import useQuery from "~/hooks/useQuery";
import useStores from "~/hooks/useStores";
import type { SearchResult } from "~/types";
import { searchPath } from "~/utils/routeHelpers";
import { decodeURIComponentSafe } from "~/utils/urls";
import CollectionFilter from "./components/CollectionFilter";
import DateFilter from "./components/DateFilter";
import { DocumentFilter } from "./components/DocumentFilter";
import DocumentTypeFilter from "./components/DocumentTypeFilter";
import {
  noValueOperators,
  type PropertyFilterState,
  type PropertyFilterValue,
} from "./components/PropertyFilter";
import { PropertyFiltersSection } from "./components/PropertyFiltersSection";
import RecentSearches from "./components/RecentSearches";
import SearchInput from "./components/SearchInput";
import { SortInput } from "./components/SortInput";
import UserFilter from "./components/UserFilter";
import { HStack } from "~/components/primitives/HStack";

// ---------------------------------------------------------------------------
// URL serialization helpers
// ---------------------------------------------------------------------------

const arrayOperators = new Set([
  TDocumentPropertyFilterOperator.Between,
  TDocumentPropertyFilterOperator.IncludesAny,
  TDocumentPropertyFilterOperator.IncludesAll,
  TDocumentPropertyFilterOperator.Excludes,
]);

const defaultFilter: PropertyFilterState = {
  operator: TDocumentPropertyFilterOperator.Contains,
};

/**
 * Parse property filters from URL search params.
 *
 * @param params - the current URL search params.
 * @returns array of filter state objects.
 */
function parsePropertyFiltersFromUrl(
  params: URLSearchParams
): PropertyFilterState[] {
  // Try new JSON format first
  const raw = params.get("propertyFilters");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Array<{
        id?: string;
        op?: TDocumentPropertyFilterOperator;
        val?: unknown;
      }>;

      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((entry) => ({
          propertyDefinitionId: entry.id || undefined,
          operator: entry.op || TDocumentPropertyFilterOperator.Contains,
          value: parseUrlPropertyFilterValue(
            entry.val,
            entry.op || TDocumentPropertyFilterOperator.Contains
          ),
        }));
      }
    } catch {
      // Invalid JSON
    }
  }

  return [{ ...defaultFilter }];
}

/**
 * Serialize property filter state array to a JSON string for the URL.
 *
 * @param filters - array of property filter states.
 * @returns JSON string, or undefined if all filters are empty.
 */
function serializePropertyFiltersToUrl(
  filters: PropertyFilterState[]
): string | undefined {
  // Only persist rows that have at least a property selected or a non-default operator
  const meaningful = filters.filter(
    (filter) => filter.propertyDefinitionId && hasPropertyFilterValue(filter.value)
  );

  if (meaningful.length === 0) {
    return undefined;
  }

  const compact = meaningful.map((f) => ({
    id: f.propertyDefinitionId,
    op: f.operator,
    ...(hasPropertyFilterValue(f.value) ? { val: f.value } : {}),
  }));

  return JSON.stringify(compact);
}

/**
 * Convert a raw string URL value to a typed API value.
 *
 * @param raw - the raw string value from the URL.
 * @param operator - the filter operator.
 * @param propertyType - the property type.
 * @returns the typed value suitable for the API.
 */
function parseUrlPropertyFilterValue(
  raw: unknown,
  operator: TDocumentPropertyFilterOperator
): PropertyFilterValue | undefined {
  if (noValueOperators.has(operator) || raw === undefined || raw === null) {
    return undefined;
  }

  if (operator === TDocumentPropertyFilterOperator.Between) {
    if (Array.isArray(raw)) {
      return [String(raw[0] ?? ""), String(raw[1] ?? "")];
    }

    if (typeof raw === "string") {
      const parts = raw.split(",");
      return [parts[0] ?? "", parts[1] ?? ""];
    }

    return undefined;
  }

  if (arrayOperators.has(operator)) {
    if (Array.isArray(raw)) {
      return raw.map((entry) => String(entry)).filter(Boolean);
    }

    if (typeof raw === "string") {
      return raw.split(",").filter(Boolean);
    }

    return undefined;
  }

  if (typeof raw === "number") {
    return String(raw);
  }

  return typeof raw === "string" ? raw : undefined;
}

function hasPropertyFilterValue(value: PropertyFilterValue | undefined) {
  if (value === undefined) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((entry) => entry.trim() !== "");
  }

  return value.trim() !== "";
}

function toApiPropertyFilterValue(
  value: PropertyFilterValue | undefined,
  operator: TDocumentPropertyFilterOperator,
  propertyType: TDocumentPropertyType | undefined
): string | number | string[] | undefined {
  if (noValueOperators.has(operator) || value === undefined) {
    return undefined;
  }

  if (operator === TDocumentPropertyFilterOperator.Between) {
    return Array.isArray(value) ? value : undefined;
  }

  if (arrayOperators.has(operator)) {
    return Array.isArray(value) ? value.filter(Boolean) : undefined;
  }

  if (
    propertyType === TDocumentPropertyType.Number &&
    typeof value === "string" &&
    Number.isFinite(Number(value))
  ) {
    return Number(value);
  }

  return typeof value === "string" ? value : undefined;
}

/**
 * Determine whether a single filter row is complete enough to send to the API.
 *
 * @param f - the filter state.
 * @returns true if the filter should be included in the API call.
 */
function isFilterComplete(f: PropertyFilterState): boolean {
  if (!f.propertyDefinitionId) {
    return false;
  }

  if (noValueOperators.has(f.operator)) {
    return true;
  }

  if (f.operator === TDocumentPropertyFilterOperator.Between) {
    return (
      Array.isArray(f.value) &&
      f.value.length === 2 &&
      f.value[0] !== "" &&
      f.value[1] !== ""
    );
  }

  if (
    [
      TDocumentPropertyFilterOperator.IncludesAny,
      TDocumentPropertyFilterOperator.IncludesAll,
      TDocumentPropertyFilterOperator.Excludes,
    ].includes(f.operator)
  ) {
    return Array.isArray(f.value) && f.value.filter(Boolean).length > 0;
  }

  return typeof f.value === "string" && f.value.trim() !== "";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function Search() {
  const { t } = useTranslation();
  const { documents, searches, collections, propertyDefinitions } =
    useStores();
  const isMobile = useMobile();

  // routing
  const params = useQuery();
  const location = useLocation();
  const history = useHistory();
  const routeMatch = useRouteMatch<{ query: string }>();

  // refs
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);
  const resultListRef = React.useRef<HTMLDivElement | null>(null);
  const recentSearchesRef = React.useRef<HTMLDivElement | null>(null);

  // filters
  const decodedQuery = decodeURIComponentSafe(
    routeMatch.params.query ?? params.get("q") ?? params.get("query") ?? ""
  ).trim();
  const query = decodedQuery !== "" ? decodedQuery : undefined;
  const collectionId = params.get("collectionId") ?? "";
  const userId = params.get("userId") ?? "";
  const documentId = params.get("documentId") ?? undefined;
  const dateFilter = (params.get("dateFilter") as TDateFilter) ?? "";
  const statusFilter = params.getAll("statusFilter")?.length
    ? (params.getAll("statusFilter") as TStatusFilter[])
    : [TStatusFilter.Published, TStatusFilter.Draft];
  const titleFilter = params.get("titleFilter") === "true";
  const includeChildCollections =
    params.get("includeChildCollections") !== "false";
  const sort = (params.get("sort") as TSortFilter) ?? "";
  const direction = (params.get("direction") as TDirectionFilter) ?? "";

  // Multi-property filter state derived from URL
  const propertyFiltersState = React.useMemo(
    () => parsePropertyFiltersFromUrl(params),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      params.get("propertyFilters"),
    ]
  );

  // Build API-ready property filters from state
  const propertyFilters = React.useMemo(() => {
    const complete = propertyFiltersState.filter(isFilterComplete);
    if (complete.length === 0) {
      return undefined;
    }

    return complete.map((f) => ({
      propertyDefinitionId: f.propertyDefinitionId!,
      operator: f.operator,
      value: noValueOperators.has(f.operator)
        ? undefined
        : toApiPropertyFilterValue(
            f.value,
            f.operator,
            propertyDefinitions.get(f.propertyDefinitionId!)?.type
          ),
    }));
  }, [propertyDefinitions, propertyFiltersState]);

  const isSearchable = !!(
    query ||
    collectionId ||
    userId ||
    (propertyFilters && propertyFilters.length > 0)
  );

  const document = documentId ? documents.get(documentId) : undefined;

  const filterVisibility = {
    document: !!document,
    collection: !document,
    user: !document || !!(document && query),
    documentType: isSearchable,
    date: isSearchable,
    property: true,
    title: !!query && !document,
    includeChildCollections: !!collectionId && !document,
    sort: isSearchable,
  };

  const filters = React.useMemo(
    () => ({
      query,
      statusFilter,
      collectionId,
      userId,
      dateFilter,
      titleFilter,
      documentId,
      includeChildCollections,
      sort,
      direction,
      propertyFilters,
    }),
    [
      query,
      JSON.stringify(statusFilter),
      collectionId,
      userId,
      dateFilter,
      titleFilter,
      documentId,
      includeChildCollections,
      sort,
      direction,
      JSON.stringify(propertyFilters),
    ]
  );

  const requestFn = React.useMemo(() => {
    // Add to the searches store so this search can immediately appear in the recent searches list
    // without a flash of loading.
    if (query) {
      searches.add({
        id: uuidv4(),
        query,
        createdAt: new Date().toISOString(),
      });
    }

    if (isSearchable) {
      return async () =>
        titleFilter
          ? await documents.searchTitles(filters)
          : await documents.search(filters);
    }

    return () => Promise.resolve([] as SearchResult[]);
  }, [query, titleFilter, filters, searches, documents, isSearchable]);

  const { data, next, end, error, loading } = usePaginatedRequest(requestFn, {
    limit: Pagination.defaultLimit,
  });

  // Collection search
  const [collectionResults, setCollectionResults] = React.useState<
    Collection[]
  >([]);
  const [collectionLoading, setCollectionLoading] = React.useState(false);

  React.useEffect(() => {
    const searchCollections = async () => {
      // Only search collections when there's a text query and no document filter
      if (!query || documentId) {
        setCollectionResults([]);
        return;
      }

      setCollectionLoading(true);
      try {
        const results = await collections.search(query, {
          limit: 5,
          collectionId: collectionId || undefined,
          includeNested: includeChildCollections,
        });
        setCollectionResults(results);
      } catch {
        setCollectionResults([]);
      } finally {
        setCollectionLoading(false);
      }
    };

    void searchCollections();
  }, [query, documentId, collectionId, includeChildCollections, collections]);

  const updateLocation = (query: string) => {
    // If query came from route params, navigate to base search path
    const pathname = routeMatch.params.query ? searchPath() : location.pathname;

    history.replace({
      pathname,
      search: queryString.stringify(
        { ...queryString.parse(location.search), q: query },
        {
          skipEmptyString: true,
        }
      ),
    });
  };

  // Shared helper: write property filter state to URL, clearing legacy params
  const writePropertyFiltersToUrl = React.useCallback(
    (nextFilters: PropertyFilterState[]) => {
      const parsed = queryString.parse(location.search);

      const serialized = serializePropertyFiltersToUrl(nextFilters);
      if (serialized) {
        parsed.propertyFilters = serialized;
      } else {
        delete parsed.propertyFilters;
      }

      history.replace({
        pathname: location.pathname,
        search: queryString.stringify(parsed, { skipEmptyString: true }),
      });
    },
    [history, location.pathname, location.search]
  );

  const handlePropertyFilterChange = React.useCallback(
    (index: number, updates: Partial<PropertyFilterState>) => {
      const next = propertyFiltersState.map((f, i) =>
        i === index ? { ...f, ...updates } : f
      );
      writePropertyFiltersToUrl(next);
    },
    [propertyFiltersState, writePropertyFiltersToUrl]
  );

  const handleAddPropertyFilter = React.useCallback(() => {
    const next = [...propertyFiltersState, { ...defaultFilter }];
    writePropertyFiltersToUrl(next);
  }, [propertyFiltersState, writePropertyFiltersToUrl]);

  const handleRemovePropertyFilter = React.useCallback(
    (index: number) => {
      const next = propertyFiltersState.filter((_, i) => i !== index);
      // Always keep at least one row
      writePropertyFiltersToUrl(
        next.length > 0 ? next : [{ ...defaultFilter }]
      );
    },
    [propertyFiltersState, writePropertyFiltersToUrl]
  );

  // All filters go through the query string so that searches are bookmarkable, which neccesitates
  // some complexity as the query string is the source of truth for the filters.
  const handleFilterChange = (search: {
    collectionId?: string | undefined;
    documentId?: string | undefined;
    userId?: string | undefined;
    dateFilter?: TDateFilter;
    statusFilter?: TStatusFilter[];
    titleFilter?: boolean | undefined;
    includeChildCollections?: boolean | undefined;
    sort?: string | undefined;
    direction?: string | undefined;
  }) => {
    if (search.sort === "relevance") {
      search.sort = undefined;
      search.direction = undefined;
    }

    history.replace({
      pathname: location.pathname,
      search: queryString.stringify(
        { ...queryString.parse(location.search), ...search },
        {
          skipEmptyString: true,
        }
      ),
    });
  };

  const handleKeyDown = (ev: React.KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === "Enter") {
      updateLocation(ev.currentTarget.value);
      return;
    }

    if (ev.key === "Escape") {
      ev.preventDefault();
      return history.goBack();
    }

    if (ev.key === "ArrowUp") {
      if (ev.currentTarget.value) {
        const length = ev.currentTarget.value.length;
        const selectionEnd = ev.currentTarget.selectionEnd || 0;
        if (selectionEnd === 0) {
          ev.currentTarget.selectionStart = 0;
          ev.currentTarget.selectionEnd = length;
          ev.preventDefault();
        }
      }
    }

    if (ev.key === "ArrowDown" && !ev.shiftKey) {
      ev.preventDefault();

      if (ev.currentTarget.value) {
        const length = ev.currentTarget.value.length;
        const selectionStart = ev.currentTarget.selectionStart || 0;
        if (selectionStart < length) {
          ev.currentTarget.selectionStart = length;
          ev.currentTarget.selectionEnd = length;
          return;
        }
      }

      const firstItem = (resultListRef.current?.firstElementChild ??
        recentSearchesRef.current?.firstElementChild) as HTMLAnchorElement;

      firstItem?.focus();
    }
  };

  const handleEscape = () => searchInputRef.current?.focus();
  const showEmpty =
    !loading &&
    !collectionLoading &&
    query &&
    data?.length === 0 &&
    collectionResults.length === 0;
  const sortInput =
    filterVisibility.sort ? (
      <SortInput
        sort={sort}
        direction={direction}
        onSelect={(nextSort, nextDirection) =>
          handleFilterChange({ sort: nextSort, direction: nextDirection })
        }
      />
    ) : null;

  return (
    <Scene
      textTitle={query ? `${query} – ${t("Search")}` : t("Search")}
      actions={isMobile ? sortInput : null}
    >
      <RegisterKeyDown trigger="Escape" handler={history.goBack} />
      {(loading || collectionLoading) && <LoadingIndicator />}
      <ResultsWrapper column auto>
        <form
          method="GET"
          action={searchPath()}
          onSubmit={(ev) => ev.preventDefault()}
        >
          <SearchInput
            name="query"
            key={query ? "search" : "recent"}
            ref={searchInputRef}
            placeholder={`${
              documentId
                ? t("Search in document")
                : collectionId
                  ? t("Search in collection")
                  : t("Search")
            }…`}
            onKeyDown={handleKeyDown}
            defaultValue={query ?? ""}
          />

          <FilterContainer>
            <PrimaryFilters>
              <Flex align="center" gap={4} wrap>
                {filterVisibility.document && (
                  <DocumentFilter
                    document={document!}
                    onClick={() => {
                      handleFilterChange({ documentId: undefined });
                    }}
                  />
                )}
                {filterVisibility.collection && (
                  <CollectionFilter
                    collectionId={collectionId}
                    onSelect={(collectionId) =>
                      handleFilterChange({ collectionId })
                    }
                  />
                )}
                {filterVisibility.user && (
                  <UserFilter
                    userId={userId}
                    onSelect={(userId) => handleFilterChange({ userId })}
                  />
                )}
                {filterVisibility.documentType && (
                  <DocumentTypeFilter
                    statusFilter={statusFilter}
                    onSelect={({ statusFilter }) =>
                      handleFilterChange({ statusFilter })
                    }
                  />
                )}
                {filterVisibility.date && (
                  <DateFilter
                    dateFilter={dateFilter}
                    onSelect={(dateFilter) =>
                      handleFilterChange({ dateFilter })
                    }
                  />
                )}
                {filterVisibility.title && (
                  <ToggleFilter
                    width={26}
                    height={14}
                    label={t("Search titles only")}
                    onChange={(checked: boolean) => {
                      handleFilterChange({ titleFilter: checked });
                    }}
                    checked={titleFilter}
                    inForm={false}
                  />
                )}
                {filterVisibility.includeChildCollections && (
                  <ToggleFilter
                    width={26}
                    height={14}
                    label={t("Include nested")}
                    onChange={(checked: boolean) => {
                      handleFilterChange({ includeChildCollections: checked });
                    }}
                    checked={includeChildCollections}
                  />
                )}
              </Flex>
              {!isMobile && filterVisibility.sort && (
                <SortInput
                  sort={sort}
                  direction={direction}
                  onSelect={(sort, direction) =>
                    handleFilterChange({ sort, direction })
                  }
                />
              )}
            </PrimaryFilters>
            {filterVisibility.property && (
              <PropertyFiltersSection
                filters={propertyFiltersState}
                onChange={handlePropertyFilterChange}
                onAdd={handleAddPropertyFilter}
                onRemove={handleRemovePropertyFilter}
              />
            )}
          </FilterContainer>
        </form>
        {isSearchable ? (
          <>
            {error ? (
              <Fade>
                <Centered column>
                  <Text as="h1">{t("Something went wrong")}</Text>
                  <Text as="p" type="secondary">
                    {t(
                      "Please try again or contact support if the problem persists"
                    )}
                    .
                  </Text>
                </Centered>
              </Fade>
            ) : showEmpty ? (
              <Fade>
                <Centered column>
                  <Text as="p" type="secondary">
                    {t("No results found for your search filters.")}
                  </Text>
                </Centered>
              </Fade>
            ) : null}
            <ResultList column>
              {collectionResults.length > 0 && (
                <CollectionResultsSection>
                  <SectionHeader type="secondary" weight="bold" size="small">
                    {t("Collections")}
                  </SectionHeader>
                  {collectionResults.map((collection) => (
                    <CollectionListItem
                      key={collection.id}
                      collection={collection}
                      highlight={query}
                    />
                  ))}
                </CollectionResultsSection>
              )}
              {(data?.length || 0) > 0 && collectionResults.length > 0 && (
                <SectionHeader type="secondary" weight="bold" size="small">
                  {t("Documents")}
                </SectionHeader>
              )}
              <StyledArrowKeyNavigation
                ref={resultListRef}
                onEscape={handleEscape}
                aria-label={t("Search Results")}
                items={data ?? []}
              >
                {() =>
                  data?.length && !error
                    ? data.map((result) => (
                        <DocumentListItem
                          key={result.document.id}
                          document={result.document}
                          highlight={query}
                          context={result.context}
                          showCollection
                          showTemplate
                        />
                      ))
                    : null
                }
              </StyledArrowKeyNavigation>
              <Waypoint
                key={data?.length}
                onEnter={end || loading ? undefined : next}
                debug={env.ENVIRONMENT === "development"}
              />
            </ResultList>
          </>
        ) : documentId ? null : (
          <RecentSearches ref={recentSearchesRef} onEscape={handleEscape} />
        )}
      </ResultsWrapper>
    </Scene>
  );
}

const Centered = styled(Flex)`
  text-align: center;
  margin: 30vh auto 0;
  max-width: 380px;
  transform: translateY(-50%);
`;

const ResultsWrapper = styled(Flex)`
  ${breakpoint("tablet")`
    margin-top: 40px;
  `};
`;

const ResultList = styled(Flex)`
  margin-bottom: 150px;
`;

const StyledArrowKeyNavigation = styled(ArrowKeyNavigation)`
  display: flex;
  flex-direction: column;
  flex: 1;
`;

const FilterContainer = styled.div`
  margin-bottom: 12px;
  padding: 8px 0;

  ${breakpoint("tablet")`
    padding: 0;
  `};
`;

const PrimaryFilters = styled(HStack)`
  flex-wrap: wrap;
  justify-content: space-between;
  transition: opacity 100ms ease-in-out;
`;

const ToggleFilter = styled(Switch)`
  white-space: nowrap;
  margin-left: 8px;
  font-size: 14px;
  font-weight: 400;
`;

const CollectionResultsSection = styled.div`
  margin-bottom: 24px;
`;

const SectionHeader = styled(Text)`
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 8px;
`;

export default observer(Search);
