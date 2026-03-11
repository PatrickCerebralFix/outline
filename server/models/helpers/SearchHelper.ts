import invariant from "invariant";
import escapeRegExp from "lodash/escapeRegExp";
import find from "lodash/find";
import map from "lodash/map";
import queryParser from "pg-tsquery";
import type {
  BindOrReplacements,
  FindAttributeOptions,
  FindOptions,
  Order,
  WhereOptions,
} from "sequelize";
import { Op, Sequelize } from "sequelize";
import type {
  DateFilter,
  DocumentPropertyFilter,
  JSONValue,
} from "@shared/types";
import {
  DirectionFilter,
  DocumentPropertyFilterOperator,
  DocumentPropertyType,
  SortFilter,
} from "@shared/types";
import { StatusFilter } from "@shared/types";
import { regexIndexOf, regexLastIndexOf } from "@shared/utils/string";
import { getUrls } from "@shared/utils/urls";
import { ValidationError } from "@server/errors";
import Collection from "@server/models/Collection";
import Document from "@server/models/Document";
import PropertyDefinition from "@server/models/PropertyDefinition";
import type Share from "@server/models/Share";
import Team from "@server/models/Team";
import User from "@server/models/User";
import { sequelize } from "@server/storage/database";
import { resolveEffectivePropertyDefinitionIdsForCollections } from "@server/utils/collectionPropertyDefinitions";
import { DocumentHelper } from "./DocumentHelper";

type SearchResponse = {
  results: {
    /** The search ranking, for sorting results */
    ranking: number;
    /** A snippet of contextual text around the search result */
    context?: string;
    /** The document result */
    document: Document;
  }[];
  /** The total number of results for the search query without pagination */
  total: number;
};

type SearchOptions = {
  /** The query limit for pagination */
  limit?: number;
  /** The query offset for pagination */
  offset?: number;
  /** The text to search for */
  query?: string;
  /** Limit results to a collection. Authorization is presumed to have been done before passing to this helper. */
  collectionId?: string | null;
  /** Limit results to multiple collections. Authorization is presumed to have been done before passing to this helper. */
  collectionIds?: string[];
  /** Limit results to a shared document. */
  share?: Share;
  /** Limit results to a date range. */
  dateFilter?: DateFilter;
  /** Status of the documents to return */
  statusFilter?: StatusFilter[];
  /** Limit results to a list of documents. */
  documentIds?: string[];
  /** Limit results to a list of users that collaborated on the document. */
  collaboratorIds?: string[];
  /** The minimum number of words to be returned in the contextual snippet */
  snippetMinWords?: number;
  /** The maximum number of words to be returned in the contextual snippet */
  snippetMaxWords?: number;
  /** Structured property filters. */
  propertyFilters?: DocumentPropertyFilter[];
  /** The field to sort results by */
  sort?: SortFilter;
  /** The sort direction */
  direction?: DirectionFilter;
  /** Whether to boost results by popularity score. Defaults to true. */
  usePopularityBoost?: boolean;
};

type RankedDocument = Document & {
  id: string;
  dataValues: Partial<Document> & {
    searchRanking: number;
  };
};

export default class SearchHelper {
  /**
   * The maximum length of a search query.
   */
  public static maxQueryLength = 1000;

  /**
   * Cached regex pattern for single quotes to avoid recompilation
   */
  private static readonly SINGLE_QUOTE_REGEX = /'+/g;

  /**
   * Cached regex pattern for quoted queries
   */
  private static readonly QUOTED_QUERY_REGEX = /"([^"]*)"/g;

  /**
   * Cached regex pattern for break characters
   */
  private static readonly BREAK_CHARS_REGEX = new RegExp(
    `[ .,"'\n。！？!?…]`,
    "g"
  );

  /**
   * Cached stop words set for efficient lookup
   * Based on: https://github.com/postgres/postgres/blob/fc0d0ce978752493868496be6558fa17b7c4c3cf/src/backend/snowball/stopwords/english.stop
   */
  private static readonly STOP_WORDS = new Set([
    "i",
    "me",
    "my",
    "myself",
    "we",
    "our",
    "ours",
    "ourselves",
    "you",
    "your",
    "yours",
    "yourself",
    "yourselves",
    "he",
    "him",
    "his",
    "himself",
    "she",
    "her",
    "hers",
    "herself",
    "it",
    "its",
    "itself",
    "they",
    "them",
    "their",
    "theirs",
    "themselves",
    "what",
    "which",
    "who",
    "whom",
    "this",
    "that",
    "these",
    "those",
    "am",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "having",
    "do",
    "does",
    "did",
    "doing",
    "a",
    "an",
    "the",
    "and",
    "but",
    "if",
    "or",
    "because",
    "as",
    "until",
    "of",
    "at",
    "by",
    "for",
    "with",
    "about",
    "against",
    "into",
    "through",
    "during",
    "before",
    "after",
    "above",
    "below",
    "from",
    "down",
    "off",
    "over",
    "under",
    "again",
    "then",
    "once",
    "here",
    "there",
    "when",
    "where",
    "why",
    "any",
    "both",
    "each",
    "few",
    "other",
    "some",
    "such",
    "nor",
    "only",
    "same",
    "so",
    "than",
    "too",
    "very",
    "s",
    "t",
    "don",
    "should",
  ]);

  public static async searchForTeam(
    team: Team,
    options: SearchOptions = {}
  ): Promise<SearchResponse> {
    const { limit = 15, offset = 0, query } = options;

    const where = await this.buildWhere(team, {
      ...options,
      statusFilter: [...(options.statusFilter || []), StatusFilter.Published],
    });

    if (options.share) {
      let documentIds: string[] | undefined;

      if (options.share.collectionId) {
        const sharedCollection =
          options.share.collection ??
          (await options.share.$get("collection", { scope: "unscoped" }));
        invariant(sharedCollection, "Cannot find collection for share");
        documentIds = sharedCollection.getAllDocumentIds();
      } else if (
        options.share.documentId &&
        options.share.includeChildDocuments
      ) {
        const sharedDocument = await options.share.$get("document");
        invariant(sharedDocument, "Cannot find document for share");

        const childDocumentIds = await sharedDocument.findAllChildDocumentIds({
          archivedAt: {
            [Op.is]: null,
          },
        });

        documentIds = [sharedDocument.id, ...childDocumentIds];
      }

      where[Op.and].push({
        id: documentIds,
      });
    }

    const findOptions = this.buildFindOptions({
      query,
      sort: options.sort,
      direction: options.direction,
      usePopularityBoost: options.usePopularityBoost,
    });

    try {
      const resultsQuery = Document.unscoped().findAll({
        ...findOptions,
        where,
        limit,
        offset,
      }) as any as Promise<RankedDocument[]>;

      const countQuery = Document.unscoped().count({
        // @ts-expect-error Types are incorrect for count
        replacements: findOptions.replacements,
        where,
      }) as any as Promise<number>;
      const [results, count] = await Promise.all([resultsQuery, countQuery]);

      // Final query to get associated document data
      const documents = await Document.findAll({
        where: {
          id: map(results, "id"),
          teamId: team.id,
        },
        include: [
          {
            model: Collection,
            as: "collection",
          },
        ],
      });

      return this.buildResponse({
        query,
        results,
        documents,
        count,
      });
    } catch (err) {
      if (err.message.includes("syntax error in tsquery")) {
        throw ValidationError("Invalid search query");
      }
      throw err;
    }
  }

  public static async searchTitlesForUser(
    user: User,
    options: SearchOptions = {}
  ): Promise<Document[]> {
    const { limit = 15, offset = 0, query, ...rest } = options;
    const where = await this.buildWhere(user, rest);

    if (query) {
      where[Op.and].push({
        title: {
          [Op.iLike]: `%${query}%`,
        },
      });
    }

    const include = [
      {
        association: "memberships",
        where: {
          userId: user.id,
        },
        required: false,
        separate: false,
      },
      {
        association: "groupMemberships",
        required: false,
        separate: false,
        include: [
          {
            association: "group",
            required: true,
            include: [
              {
                association: "groupUsers",
                required: true,
                where: {
                  userId: user.id,
                },
              },
            ],
          },
        ],
      },
      {
        model: User,
        as: "createdBy",
        paranoid: false,
      },
      {
        model: User,
        as: "updatedBy",
        paranoid: false,
      },
    ];

    return Document.withMembershipScope(user.id, {
      includeDrafts: true,
    }).findAll({
      where,
      subQuery: false,
      order: [
        [
          options.sort ?? SortFilter.UpdatedAt,
          options.direction ?? DirectionFilter.DESC,
        ],
      ],
      include,
      offset,
      limit,
    });
  }

  public static async searchCollectionsForUser(
    user: User,
    options: SearchOptions = {}
  ): Promise<Collection[]> {
    const { limit = 15, offset = 0, query } = options;

    const collectionIds = await user.collectionIds();

    return Collection.findAll({
      where: {
        [Op.and]: query
          ? {
              [Op.or]: [
                Sequelize.literal(
                  `unaccent(LOWER(name)) like unaccent(LOWER(:query))`
                ),
              ],
            }
          : {},
        id: collectionIds,
        teamId: user.teamId,
      },
      order: [["name", "ASC"]],
      replacements: { query: `%${query}%` },
      limit,
      offset,
    });
  }

  public static async searchForUser(
    user: User,
    options: SearchOptions = {}
  ): Promise<SearchResponse> {
    const { limit = 15, offset = 0, query } = options;

    const where = await this.buildWhere(user, options);

    const findOptions = this.buildFindOptions({
      query,
      sort: options.sort,
      direction: options.direction,
    });

    const include = [
      {
        association: "memberships",
        where: {
          userId: user.id,
        },
        required: false,
        separate: false,
      },
      {
        association: "groupMemberships",
        required: false,
        separate: false,
        include: [
          {
            association: "group",
            required: true,
            include: [
              {
                association: "groupUsers",
                required: true,
                where: {
                  userId: user.id,
                },
              },
            ],
          },
        ],
      },
    ];

    try {
      const results = (await Document.unscoped().findAll({
        ...findOptions,
        subQuery: false,
        include,
        where,
        limit,
        offset,
      })) as any as RankedDocument[];

      const countQuery = Document.unscoped().count({
        // @ts-expect-error Types are incorrect for count
        subQuery: false,
        include,
        replacements: findOptions.replacements,
        where,
      }) as any as Promise<number>;

      // Final query to get associated document data
      const [documents, count] = await Promise.all([
        Document.withMembershipScope(user.id, { includeDrafts: true }).findAll({
          where: {
            teamId: user.teamId,
            id: map(results, "id"),
          },
        }),
        results.length < limit && offset === 0
          ? Promise.resolve(results.length)
          : countQuery,
      ]);

      return this.buildResponse({
        query,
        results,
        documents,
        count,
      });
    } catch (err) {
      if (err.message.includes("syntax error in tsquery")) {
        throw ValidationError("Invalid search query");
      }
      throw err;
    }
  }

  private static buildFindOptions({
    query,
    sort,
    direction,
    usePopularityBoost = true,
  }: {
    query?: string;
    sort?: SortFilter;
    direction?: DirectionFilter;
    usePopularityBoost?: boolean;
  }): FindOptions {
    const attributes: FindAttributeOptions = ["id"];
    const replacements: BindOrReplacements = {};
    const order: Order = [];

    if (query) {
      const rankExpression = usePopularityBoost
        ? `ts_rank("searchVector", to_tsquery('english', :query)) * (1 + 0.25 * LN(1 + COALESCE("popularityScore", 0)))`
        : `ts_rank("searchVector", to_tsquery('english', :query))`;

      attributes.push([Sequelize.literal(rankExpression), "searchRanking"]);
      replacements["query"] = this.webSearchQuery(query);
    }

    // When searching with a query and no explicit sort, prioritize search
    // ranking as the primary sort criterion. Otherwise, use the specified sort
    // with ranking as a tiebreaker.
    if (query && !sort) {
      order.push(["searchRanking", "DESC"]);
      order.push([SortFilter.UpdatedAt, DirectionFilter.DESC]);
    } else {
      const sortField = sort ?? SortFilter.UpdatedAt;
      const sortDirection = direction ?? DirectionFilter.DESC;

      if (sortField === SortFilter.Title) {
        order.push([
          Sequelize.fn("LOWER", Sequelize.col("title")),
          sortDirection,
        ]);
      } else {
        order.push([sortField, sortDirection]);
      }

      if (query) {
        order.push(["searchRanking", "DESC"]);
      }
    }

    return { attributes, replacements, order };
  }

  private static buildResultContext(document: Document, query: string) {
    // Reset regex lastIndex to avoid state issues with global regex
    this.QUOTED_QUERY_REGEX.lastIndex = 0;
    const quotedQueries = Array.from(query.matchAll(this.QUOTED_QUERY_REGEX));
    const text = DocumentHelper.toPlainText(document);

    // Regex to highlight quoted queries as ts_headline will not do this by default due to stemming.
    const fullMatchRegex = new RegExp(escapeRegExp(query), "i");
    const highlightRegex = new RegExp(
      [
        fullMatchRegex.source,
        ...(quotedQueries.length
          ? quotedQueries.map((match) => escapeRegExp(match[1]))
          : this.removeStopWords(query)
              .trim()
              .split(" ")
              .map((match) => `\\b${escapeRegExp(match)}\\b`)),
      ].join("|"),
      "gi"
    );

    // Reset regex lastIndex to avoid state issues with global regex
    this.BREAK_CHARS_REGEX.lastIndex = 0;
    const breakCharsRegex = this.BREAK_CHARS_REGEX;

    // chop text around the first match, prefer the first full match if possible.
    const fullMatchIndex = text.search(fullMatchRegex);
    const offsetStartIndex =
      (fullMatchIndex >= 0 ? fullMatchIndex : text.search(highlightRegex)) - 65;
    const startIndex = Math.max(
      0,
      offsetStartIndex <= 0
        ? 0
        : regexIndexOf(text, breakCharsRegex, offsetStartIndex)
    );
    const context = text.replace(highlightRegex, "<b>$&</b>");
    const endIndex = regexLastIndexOf(
      context,
      breakCharsRegex,
      startIndex + 250
    );

    return context.slice(startIndex, endIndex);
  }

  private static async buildWhere(model: User | Team, options: SearchOptions) {
    const teamId = model instanceof Team ? model.id : model.teamId;
    const where: WhereOptions<Document> & {
      [Op.or]: WhereOptions<Document>[];
      [Op.and]: WhereOptions<Document>[];
    } = {
      teamId,
      [Op.or]: [],
      [Op.and]: [
        {
          deletedAt: {
            [Op.eq]: null,
          },
        },
      ],
    };

    if (model instanceof User) {
      where[Op.or].push(
        { "$memberships.id$": { [Op.ne]: null } },
        { "$groupMemberships.id$": { [Op.ne]: null } }
      );
    }

    // Ensure we're filtering by the users accessible collections. If
    // collectionId or collectionIds are passed as options it is assumed that
    // the authorization has already been done in the router
    const userCollectionIds = await model.collectionIds();

    // Determine which collection IDs to filter by
    let filterCollectionIds: string[];
    if (options.collectionIds) {
      // Filter by multiple collections (intersect with user's accessible collections)
      filterCollectionIds = options.collectionIds.filter((id) =>
        userCollectionIds.includes(id)
      );
      where[Op.and].push({ collectionId: filterCollectionIds });
    } else if (options.collectionId) {
      // Filter by single collection (backwards compatibility)
      filterCollectionIds = [options.collectionId];
      where[Op.and].push({ collectionId: options.collectionId });
    } else {
      // No specific collection filter, use all accessible collections
      filterCollectionIds = userCollectionIds;
    }

    if (filterCollectionIds.length) {
      where[Op.or].push({ collectionId: filterCollectionIds });
    }

    if (options.dateFilter) {
      where[Op.and].push({
        updatedAt: {
          [Op.gt]: sequelize.literal(
            `now() - interval '1 ${options.dateFilter}'`
          ),
        },
      });
    }

    if (options.collaboratorIds) {
      where[Op.and].push({
        collaboratorIds: {
          [Op.contains]: options.collaboratorIds,
        },
      });
    }

    if (options.documentIds) {
      where[Op.and].push({
        id: options.documentIds,
      });
    }

    if (options.propertyFilters?.length) {
      const allowedPropertyDefinitionIds =
        await resolveEffectivePropertyDefinitionIdsForCollections(
          filterCollectionIds,
          model instanceof Team ? model.id : model.teamId
        );
      const propertyFilterWheres = await Promise.all(
        options.propertyFilters.map((propertyFilter) =>
          this.buildPropertyFilterWhere(propertyFilter, {
            collectionIds: filterCollectionIds,
            teamId: model instanceof Team ? model.id : model.teamId,
            allowedPropertyDefinitionIds,
          })
        )
      );

      where[Op.and].push(...propertyFilterWheres);
    }

    const statusQuery = [];
    if (options.statusFilter?.includes(StatusFilter.Published)) {
      statusQuery.push({
        [Op.and]: [
          {
            publishedAt: {
              [Op.ne]: null,
            },
            archivedAt: {
              [Op.eq]: null,
            },
          },
        ],
      });
    }

    if (
      options.statusFilter?.includes(StatusFilter.Draft) &&
      // Only ever include draft results for the user's own documents
      model instanceof User
    ) {
      statusQuery.push({
        [Op.and]: [
          {
            publishedAt: {
              [Op.eq]: null,
            },
            archivedAt: {
              [Op.eq]: null,
            },
            [Op.or]: [
              { createdById: model.id },
              { "$memberships.id$": { [Op.ne]: null } },
            ],
          },
        ],
      });
    }

    if (options.statusFilter?.includes(StatusFilter.Archived)) {
      statusQuery.push({
        archivedAt: {
          [Op.ne]: null,
        },
      });
    }

    if (statusQuery.length) {
      where[Op.and].push({
        [Op.or]: statusQuery,
      });
    }

    if (options.query) {
      // find words that look like urls, these should be treated separately as the postgres full-text
      // index will generally not match them.
      let likelyUrls = getUrls(options.query);

      // remove likely urls, and escape the rest of the query.
      let limitedQuery = this.escapeQuery(
        likelyUrls
          .reduce((q, url) => q.replace(url, ""), options.query)
          .slice(0, this.maxQueryLength)
          .trim()
      );

      // Escape the URLs
      likelyUrls = likelyUrls.map((url) => this.escapeQuery(url));

      // Extract quoted queries and add them to the where clause, up to a maximum of 3 total.
      const quotedQueries = Array.from(limitedQuery.matchAll(/"([^"]*)"/g)).map(
        (match) => match[1]
      );

      // remove quoted queries from the limited query
      limitedQuery = limitedQuery.replace(/"([^"]*)"/g, "");

      const iLikeQueries = [...quotedQueries, ...likelyUrls].slice(0, 3);

      for (const match of iLikeQueries) {
        where[Op.and].push({
          [Op.or]: [
            {
              title: {
                [Op.iLike]: `%${match}%`,
              },
            },
            {
              text: {
                [Op.iLike]: `%${match}%`,
              },
            },
          ],
        });
      }

      if (limitedQuery || iLikeQueries.length === 0) {
        where[Op.and].push(
          Sequelize.fn(
            `"searchVector" @@ to_tsquery`,
            "english",
            Sequelize.literal(":query")
          )
        );
      }
    }

    return where;
  }

  private static async buildPropertyFilterWhere(
    propertyFilter: DocumentPropertyFilter,
    options: {
      collectionIds: string[];
      teamId: string;
      allowedPropertyDefinitionIds: Map<string, Set<string>>;
    }
  ): Promise<WhereOptions<Document>> {
    const definitions = await this.resolvePropertyFilterDefinitions(
      propertyFilter,
      options
    );

    return this.buildPropertyFilterWhereForDefinitions({
      definitions,
      operator: propertyFilter.operator,
      value: propertyFilter.value,
      teamId: options.teamId,
    });
  }

  private static async resolvePropertyFilterDefinitions(
    propertyFilter: DocumentPropertyFilter,
    options: {
      collectionIds: string[];
      teamId: string;
      allowedPropertyDefinitionIds: Map<string, Set<string>>;
    }
  ) {
    if (options.collectionIds.length === 0) {
      return [];
    }

    const validDefinitionId = /^[0-9a-fA-F-]{36}$/.test(
      propertyFilter.propertyDefinitionId
    );

    if (!validDefinitionId) {
      throw ValidationError("Invalid property definition ID");
    }

    const allowedDefinitionIds = new Set<string>();
    for (const collectionId of options.collectionIds) {
      for (const definitionId of
        options.allowedPropertyDefinitionIds.get(collectionId) ?? []) {
        allowedDefinitionIds.add(definitionId);
      }
    }

    if (!allowedDefinitionIds.has(propertyFilter.propertyDefinitionId)) {
      throw ValidationError("Property definition is not available in scope");
    }

    return PropertyDefinition.findAll({
      where: {
        id: propertyFilter.propertyDefinitionId,
        teamId: options.teamId,
        deletedAt: null,
      },
      include: [
        {
          association: "options",
          required: false,
        },
      ],
    });
  }

  private static async buildPropertyFilterWhereForDefinitions({
    definitions,
    operator,
    value,
    teamId,
  }: {
    definitions: PropertyDefinition[];
    operator: DocumentPropertyFilterOperator;
    value: DocumentPropertyFilter["value"];
    teamId: string;
  }): Promise<WhereOptions<Document>> {
    if (definitions.length === 0) {
      return this.noPropertyFilterMatches();
    }

    const userFilterValue = await this.normalizeUserPropertyFilterValue({
      definitions,
      operator,
      value,
      teamId,
    });

    const expressions = definitions.map((definition) =>
      this.buildPropertyFilterExpressionForDefinition({
        definition,
        operator,
        value,
        userFilterValue,
      })
    );

    return Sequelize.where(
      Sequelize.literal(
        `(${this.combinePropertyFilterExpressions(operator, expressions)})`
      ),
      Op.eq,
      true
    ) as WhereOptions<Document>;
  }

  private static buildPropertyFilterExpressionForDefinition({
    definition,
    operator,
    value,
    userFilterValue,
  }: {
    definition: PropertyDefinition;
    operator: DocumentPropertyFilterOperator;
    value: DocumentPropertyFilter["value"];
    userFilterValue?: string[];
  }) {
    const propertyValueExpr = this.buildPropertyValueExpression(definition.id);
    const normalizedValue =
      definition.type === DocumentPropertyType.User
        ? userFilterValue
        : this.normalizeSelectableFilterValue(definition, value);

    switch (operator) {
      case DocumentPropertyFilterOperator.Equals: {
        this.assertUserPropertyFilterOperator(definition.type, operator);
        if (normalizedValue === undefined) {
          throw ValidationError("Property filter value is required for eq");
        }

        return `(${propertyValueExpr} = ${this.toJSONBExpression(normalizedValue)})`;
      }

      case DocumentPropertyFilterOperator.Contains: {
        this.assertUserPropertyFilterOperator(definition.type, operator);
        if (normalizedValue === undefined) {
          throw ValidationError(
            "Property filter value is required for contains"
          );
        }

        const containsExpr = this.toJSONBExpression(
          Array.isArray(normalizedValue) ? normalizedValue : [normalizedValue]
        );
        const scalarExpr = Array.isArray(normalizedValue)
          ? undefined
          : this.toJSONBExpression(normalizedValue);

        return scalarExpr
          ? `(${propertyValueExpr} = ${scalarExpr} OR COALESCE(${propertyValueExpr}, '[]'::jsonb) @> ${containsExpr})`
          : `COALESCE(${propertyValueExpr}, '[]'::jsonb) @> ${containsExpr}`;
      }

      case DocumentPropertyFilterOperator.IsEmpty:
        this.assertUserPropertyFilterOperator(definition.type, operator);
        return this.buildPropertyIsEmptyExpression(propertyValueExpr);

      case DocumentPropertyFilterOperator.IsNotEmpty:
        this.assertUserPropertyFilterOperator(definition.type, operator);
        return `NOT ${this.buildPropertyIsEmptyExpression(propertyValueExpr)}`;

      case DocumentPropertyFilterOperator.GreaterThan: {
        this.assertUserPropertyFilterOperator(definition.type, operator);
        if (normalizedValue === undefined) {
          throw ValidationError("Property filter value is required for gt");
        }

        return this.buildComparablePropertyExpression({
          propertyValueExpr,
          propertyType: definition.type,
          operator,
          value: normalizedValue,
        });
      }

      case DocumentPropertyFilterOperator.LessThan: {
        this.assertUserPropertyFilterOperator(definition.type, operator);
        if (normalizedValue === undefined) {
          throw ValidationError("Property filter value is required for lt");
        }

        return this.buildComparablePropertyExpression({
          propertyValueExpr,
          propertyType: definition.type,
          operator,
          value: normalizedValue,
        });
      }

      case DocumentPropertyFilterOperator.Between: {
        this.assertUserPropertyFilterOperator(definition.type, operator);
        if (!Array.isArray(normalizedValue) || normalizedValue.length !== 2) {
          throw ValidationError(
            "Property filter value must be a 2-element array for between"
          );
        }

        return this.buildBetweenPropertyExpression({
          propertyValueExpr,
          propertyType: definition.type,
          value: normalizedValue,
        });
      }

      case DocumentPropertyFilterOperator.IncludesAny: {
        this.assertUserPropertyFilterOperator(definition.type, operator);
        const values = this.normalizeArrayPropertyFilterValue(
          normalizedValue,
          "includes_any"
        );

        return `COALESCE(${propertyValueExpr}, '[]'::jsonb) ?| ${this.toTextArrayExpression(
          values
        )}`;
      }

      case DocumentPropertyFilterOperator.IncludesAll: {
        this.assertUserPropertyFilterOperator(definition.type, operator);
        const values = this.normalizeArrayPropertyFilterValue(
          normalizedValue,
          "includes_all"
        );

        return `COALESCE(${propertyValueExpr}, '[]'::jsonb) @> ${this.toJSONBExpression(
          values
        )}`;
      }

      case DocumentPropertyFilterOperator.Excludes: {
        this.assertUserPropertyFilterOperator(definition.type, operator);
        const values = this.normalizeArrayPropertyFilterValue(
          normalizedValue,
          "excludes"
        );

        return `NOT (COALESCE(${propertyValueExpr}, '[]'::jsonb) ?| ${this.toTextArrayExpression(
          values
        )})`;
      }

      default:
        throw ValidationError("Unsupported property filter operator");
    }
  }

  private static buildPropertyValueExpression(propertyDefinitionId: string) {
    return `COALESCE("properties", '{}'::jsonb) -> ${sequelize.escape(
      propertyDefinitionId
    )}`;
  }

  private static combinePropertyFilterExpressions(
    operator: DocumentPropertyFilterOperator,
    expressions: string[]
  ) {
    if (expressions.length === 0) {
      return "FALSE";
    }

    const joiner =
      operator === DocumentPropertyFilterOperator.IsEmpty ||
      operator === DocumentPropertyFilterOperator.Excludes
        ? " AND "
        : " OR ";

    return expressions.length === 1
      ? expressions[0]
      : `(${expressions.join(joiner)})`;
  }

  private static buildComparablePropertyExpression({
    propertyValueExpr,
    propertyType,
    operator,
    value,
  }: {
    propertyValueExpr: string;
    propertyType: DocumentPropertyType;
    operator:
      | DocumentPropertyFilterOperator.GreaterThan
      | DocumentPropertyFilterOperator.LessThan;
    value: Exclude<DocumentPropertyFilter["value"], undefined>;
  }) {
    if (propertyType === DocumentPropertyType.Number) {
      const normalizedValue = this.normalizeNumericPropertyFilterValue(value);
      const comparator =
        operator === DocumentPropertyFilterOperator.GreaterThan ? ">" : "<";

      return `jsonb_typeof(${propertyValueExpr}) = 'number' AND (${propertyValueExpr} #>> '{}')::numeric ${comparator} ${sequelize.escape(
        normalizedValue
      )}::numeric`;
    }

    const normalizedValue =
      propertyType === DocumentPropertyType.Date
        ? this.normalizeDatePropertyFilterValue(value)
        : this.normalizeStringPropertyFilterValue(value);
    const comparator =
      operator === DocumentPropertyFilterOperator.GreaterThan ? ">" : "<";

    return `jsonb_typeof(${propertyValueExpr}) = 'string' AND (${propertyValueExpr} #>> '{}') ${comparator} ${sequelize.escape(
      normalizedValue
    )}`;
  }

  private static buildBetweenPropertyExpression({
    propertyValueExpr,
    propertyType,
    value,
  }: {
    propertyValueExpr: string;
    propertyType: DocumentPropertyType;
    value: DocumentPropertyFilter["value"] & JSONValue[];
  }) {
    const [rawMin, rawMax] = value;

    if (rawMin === undefined || rawMax === undefined) {
      throw ValidationError(
        "Property filter value must be a 2-element array for between"
      );
    }

    if (propertyType === DocumentPropertyType.Number) {
      const min = this.normalizeNumericPropertyFilterValue(rawMin);
      const max = this.normalizeNumericPropertyFilterValue(rawMax);

      return `jsonb_typeof(${propertyValueExpr}) = 'number' AND (${propertyValueExpr} #>> '{}')::numeric >= ${sequelize.escape(
        min
      )}::numeric AND (${propertyValueExpr} #>> '{}')::numeric <= ${sequelize.escape(
        max
      )}::numeric`;
    }

    const min =
      propertyType === DocumentPropertyType.Date
        ? this.normalizeDatePropertyFilterValue(rawMin)
        : this.normalizeStringPropertyFilterValue(rawMin);
    const max =
      propertyType === DocumentPropertyType.Date
        ? this.normalizeDatePropertyFilterValue(rawMax)
        : this.normalizeStringPropertyFilterValue(rawMax);

    return `jsonb_typeof(${propertyValueExpr}) = 'string' AND (${propertyValueExpr} #>> '{}') >= ${sequelize.escape(
      min
    )} AND (${propertyValueExpr} #>> '{}') <= ${sequelize.escape(max)}`;
  }

  private static normalizeArrayPropertyFilterValue(
    value: DocumentPropertyFilter["value"],
    operator: "includes_any" | "includes_all" | "excludes"
  ) {
    if (!Array.isArray(value) || value.length === 0) {
      throw ValidationError(
        `Property filter value must be a non-empty array for ${operator}`
      );
    }

    const normalized = Array.from(
      new Set(
        value
          .map((entry) => String(entry).trim())
          .filter((entry) => entry.length > 0)
      )
    );

    if (normalized.length === 0) {
      throw ValidationError(
        `Property filter value must be a non-empty array for ${operator}`
      );
    }

    return normalized;
  }

  private static normalizeSelectableFilterValue(
    definition: PropertyDefinition,
    value: DocumentPropertyFilter["value"]
  ) {
    if (
      value === undefined ||
      (definition.type !== DocumentPropertyType.Select &&
        definition.type !== DocumentPropertyType.MultiSelect)
    ) {
      return value;
    }

    const optionIdsByValue = new Map(
      (definition.options ?? []).map((option) => [
        option.value.trim().toLowerCase(),
        option.id,
      ])
    );

    if (Array.isArray(value)) {
      return value.map((entry) => {
        const normalizedEntry = String(entry).trim().toLowerCase();
        return optionIdsByValue.get(normalizedEntry) ?? String(entry);
      });
    }

    if (typeof value !== "string") {
      return value;
    }

    const normalizedValue = value.trim().toLowerCase();
    return optionIdsByValue.get(normalizedValue) ?? value;
  }

  private static assertUserPropertyFilterOperator(
    propertyType: DocumentPropertyType,
    operator: DocumentPropertyFilterOperator
  ) {
    if (propertyType !== DocumentPropertyType.User) {
      return;
    }

    if (
      operator !== DocumentPropertyFilterOperator.IncludesAny &&
      operator !== DocumentPropertyFilterOperator.IncludesAll &&
      operator !== DocumentPropertyFilterOperator.Excludes &&
      operator !== DocumentPropertyFilterOperator.IsEmpty &&
      operator !== DocumentPropertyFilterOperator.IsNotEmpty
    ) {
      throw ValidationError("Unsupported operator for user property filters");
    }
  }

  private static async normalizeUserPropertyFilterValue({
    definitions,
    operator,
    value,
    teamId,
  }: {
    definitions: PropertyDefinition[];
    operator: DocumentPropertyFilterOperator;
    value: DocumentPropertyFilter["value"];
    teamId: string;
  }): Promise<string[] | undefined> {
    const hasUserDefinition = definitions.some(
      (definition) => definition.type === DocumentPropertyType.User
    );

    if (!hasUserDefinition) {
      return undefined;
    }

    this.assertUserPropertyFilterOperator(DocumentPropertyType.User, operator);

    if (
      operator === DocumentPropertyFilterOperator.IsEmpty ||
      operator === DocumentPropertyFilterOperator.IsNotEmpty
    ) {
      return undefined;
    }

    let arrayOperator:
      | "includes_any"
      | "includes_all"
      | "excludes";

    switch (operator) {
      case DocumentPropertyFilterOperator.IncludesAny:
        arrayOperator = "includes_any";
        break;
      case DocumentPropertyFilterOperator.IncludesAll:
        arrayOperator = "includes_all";
        break;
      case DocumentPropertyFilterOperator.Excludes:
        arrayOperator = "excludes";
        break;
      default:
        throw ValidationError("Unsupported operator for user property filters");
    }

    const normalizedUserIds = this.normalizeArrayPropertyFilterValue(
      value,
      arrayOperator
    );
    const users = await User.findAll({
      attributes: ["id"],
      where: {
        id: normalizedUserIds,
        teamId,
      },
    });
    const validUserIds = new Set(users.map((user) => user.id));

    if (normalizedUserIds.some((userId) => !validUserIds.has(userId))) {
      throw ValidationError("Invalid user ID in property filter");
    }

    return normalizedUserIds;
  }

  private static normalizeNumericPropertyFilterValue(
    value: Exclude<DocumentPropertyFilter["value"], undefined>
  ) {
    const numericValue =
      typeof value === "number" ? value : Number(String(value));

    if (!Number.isFinite(numericValue)) {
      throw ValidationError("Property filter value must be numeric");
    }

    return String(numericValue);
  }

  private static normalizeDatePropertyFilterValue(
    value: Exclude<DocumentPropertyFilter["value"], undefined>
  ) {
    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
      throw ValidationError("Property filter value must be a valid date");
    }

    return value;
  }

  private static normalizeStringPropertyFilterValue(
    value: Exclude<DocumentPropertyFilter["value"], undefined>
  ) {
    const normalized = String(value).trim();

    if (!normalized) {
      throw ValidationError("Property filter value must not be empty");
    }

    return normalized;
  }

  private static buildPropertyIsEmptyExpression(propertyValueExpr: string) {
    return `(
      ${propertyValueExpr} IS NULL OR
      ${propertyValueExpr} = 'null'::jsonb OR
      ${propertyValueExpr} = '[]'::jsonb OR
      ${propertyValueExpr} = '""'::jsonb
    )`;
  }

  private static toJSONBExpression(
    value: Exclude<DocumentPropertyFilter["value"], undefined>
  ) {
    return `CAST(${sequelize.escape(JSON.stringify(value))} AS jsonb)`;
  }

  private static toTextArrayExpression(values: string[]) {
    return `ARRAY[${values.map((value) => sequelize.escape(value)).join(",")}]`;
  }

  private static noPropertyFilterMatches() {
    return Sequelize.where(
      Sequelize.literal("FALSE"),
      Op.eq,
      true
    ) as WhereOptions<Document>;
  }

  private static buildResponse({
    query,
    results,
    documents,
    count,
  }: {
    query?: string;
    results: RankedDocument[];
    documents: Document[];
    count: number;
  }): SearchResponse {
    return {
      results: map(results, (result) => {
        const document = find(documents, {
          id: result.id,
        }) as Document;

        return {
          ranking: result.dataValues.searchRanking,
          context: query ? this.buildResultContext(document, query) : undefined,
          document,
        };
      }),
      total: count,
    };
  }

  /**
   * Convert a user search query into a format that can be used by Postgres
   *
   * @param query The user search query
   * @returns The query formatted for Postgres ts_query
   */
  public static webSearchQuery(query: string): string {
    // limit length of search queries as we're using regex against untrusted input
    let limitedQuery = this.escapeQuery(query.slice(0, this.maxQueryLength));

    const quotedSearch =
      limitedQuery.startsWith('"') && limitedQuery.endsWith('"');

    // Replace single quote characters with &.
    // Reset regex lastIndex to avoid state issues with global regex
    this.SINGLE_QUOTE_REGEX.lastIndex = 0;
    const singleQuotes = limitedQuery.matchAll(this.SINGLE_QUOTE_REGEX);

    for (const match of singleQuotes) {
      if (
        match.index &&
        match.index > 0 &&
        match.index < limitedQuery.length - 1
      ) {
        limitedQuery =
          limitedQuery.substring(0, match.index) +
          "&" +
          limitedQuery.substring(match.index + 1);
      }
    }

    return (
      queryParser()(
        // Although queryParser trims the query, looks like there's a
        // bug for certain cases where it removes other characters in addition to
        // spaces. Ref: https://github.com/caub/pg-tsquery/issues/27
        quotedSearch ? limitedQuery.trim() : `${limitedQuery.trim()}*`
      )
        // Remove any trailing join characters
        .replace(/&$/, "")
        // Remove any trailing escape characters
        .replace(/\\$/, "")
    );
  }

  private static escapeQuery(query: string): string {
    return (
      query
        // replace "\" with escaped "\\" because sequelize.escape doesn't do it
        // see: https://github.com/sequelize/sequelize/issues/2950
        .replace(/\\/g, "\\\\")
        // replace ":" with escaped "\:" because it's a reserved character in tsquery
        // see: https://github.com/outline/outline/issues/6542
        .replace(/:/g, "\\:")
    );
  }

  private static removeStopWords(query: string): string {
    // Based on:
    // https://github.com/postgres/postgres/blob/fc0d0ce978752493868496be6558fa17b7c4c3cf/src/backend/snowball/stopwords/english.stop
    return query
      .split(" ")
      .filter((word) => !this.STOP_WORDS.has(word))
      .join(" ");
  }
}
