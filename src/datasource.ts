import { Datastore } from '@google-cloud/datastore'
import { entity, Entity as DataStoreEntity } from '@google-cloud/datastore/build/src/entity'
import { Query } from '@google-cloud/datastore/build/src/query'
import {
  CommitResponse,
  CreateReadStreamOptions,
  DeleteResponse,
  UpdateResponse,
} from '@google-cloud/datastore/build/src/request'
import { Count, Entity } from '@loopback/repository'
import { CallOptions } from 'google-gax'
import * as Long from 'long'
import { Connector } from 'loopback-connector'
import * as path from 'path'

type LoopBackEntity = Entity
type LoopBackCountResult = Count
type GCPDataStoreEntity = DataStoreEntity
type EntityKey = entity.Key
type Filter = { [key: string]: any }
type OrderQuery = {
  ascending?: boolean
  descending?: boolean
}
type CallbackFunction = (error?: Error, result?: any) => {}

function initializeDataSource(dataSource, callback: CallbackFunction) {
  dataSource.connector = new GoogleCloudDatastore(dataSource.settings)
  process.nextTick(() => {
    callback()
  })
}

class GoogleCloudDatastore extends Connector {
  datastore: Datastore

  constructor(dataSourceProperties: any) {
    super()
    const { keyFilename, projectId } = dataSourceProperties
    this.datastore = new Datastore({
      keyFilename: path.resolve(keyFilename),
      projectId,
    })
  }

  /**
   * Create {@link EntityKey} for a specific LoopBack model.
   *
   * A {@link EntityKey} is a tuple structure made of [KindName, id]. A Kind can be thought of as
   * a Collection in MongoDB or a Table in SQL. It is used to organize a group
   * of {@link GCPDataStoreEntity}.
   *
   * If the LoopBack Model name changes, the entity persisted will be associated with a new key
   * using the new model name as the Kind. So you want to refactor your code carefully else
   * Entities may end up in a different collection; resulting in unexpected query operations.
   *
   * For more information on LoopBack model definitions, visit:
   * https://loopback.io/doc/en/lb4/Model.html
   *
   * @param {String} kindName - name of the model defined in LoopBack's model annotation.
   *  For Example: @model({ name: Task.name })
   * @returns {EntityKey}
   */
  private createEntityKey(kindName: string): EntityKey {
    return this.datastore.key(kindName)
  }

  /**
   * Create Key for a specific LoopBack model with the id of an existing {@link GCPDataStoreEntity}
   * attached.
   *
   * Refer to {@link createEntityKey} for more information on {@link EntityKey} and what it
   * represents.
   *
   * An {@link EntityKey} with an id of an existing {@link GCPDataStoreEntity} tells the Google
   * Datastore api that we're working with an existing object so it will automatically use the
   * right operations in methods. In the {@link this.datastore.save} method for example, it will
   * use the 'update' method instead of creating a new object using the 'insert' method.
   *
   * @param {String} kindName - name of the model defined in LoopBack's model annotation.
   *  For Example: @model({ name: Task.name }). This will be used as the Kind name for GCP
   *  Datastore.
   * @param {String} id - id for existing {@link GCPDataStoreEntity}.
   * @returns {EntityKey}
   */
  private createEntityKeyWithId(kindName: string, id: string): EntityKey {
    return this.datastore.key([kindName, Number.parseInt(id)])
  }

  /**
   * Creates valid {@link GCPDataStoreEntity} that is ready to be saved to a specified Kind.
   *
   * @param {object} entityProperties - an object literal containing properties and values
   *  for a given instance of an {@link LoopBackEntity}. These properties and their values will be
   *  persisted into the new or existing {@link GCPDataStoreEntity}.
   * @param {EntityKey} key - a valid entity Key used to organize groups of
   *  {@link GCPDataStoreEntity}.
   * @returns {{data: object & {createdAt: string; updatedAt: null}; key: entity.Key}}
   */
  private static createEntity(entityProperties: object, key: EntityKey): GCPDataStoreEntity {
    const data = Object.assign(entityProperties, {
      createdAt: new Date().toJSON(),
      updatedAt: null,
      id: key.name,
    })
    return {
      key,
      data,
    }
  }

  /**
   * Create new {@link GCPDataStoreEntity}.
   *
   * When successful, it will execute the callback with the value of the new
   * {@link GCPDataStoreEntity}'s id. LoopBack will substitute the id property on the
   * {@link LoopBackEntity}'s model definition with the result of the callback. Loopback does not
   * take any further information from the Datastore response, instead it assumes the persistence
   * later won't modify the original values used to form the persistence request and just appends
   * the id to the previously undefined id property.
   *
   * @param {String} model - name of the model defined in LoopBack's model annotation.
   *  For Example: @model({ name: Task.name })
   * @param {Object} data - the property/value pairs to be created
   * @param {Object} options - configure network options.
   * @param {Function} [callback] - LoopBack relies on this being a callback and not a promise
   *  to bubble up the result.
   * @returns Promise<void>
   */
  async create(
    model: string,
    data: object,
    options: CallOptions,
    callback: CallbackFunction,
  ): Promise<void> {
    try {
      const key = this.createEntityKey(model)
      const entity = GoogleCloudDatastore.createEntity(data, key)
      const result = await this.datastore.save(entity, options)
      const id = GoogleCloudDatastore.extractIdFromFirstCommitResponse(result)
      callback(null, id)
    } catch (error) {
      console.error(error)
    }
  }

  /**
   * Given only one item was committed to the database, extract the id from that
   * committed Entity.
   *
   * @param {T} response - a response describing what was committed to the database.
   * @returns {number | Long | string | null} - if the {@link GCPDataStoreEntity} has a valid id,
   *  i.e. it has been persisted to the database at some point, it will not return null.
   */
  private static extractIdFromFirstCommitResponse<T extends CommitResponse>(
    response: T,
  ): number | Long | string | null {
    const firstCommitResult = response[0]
    return firstCommitResult?.mutationResults[0]?.key?.path[0]?.id
  }

  /**
   * Complete the {@link GCPDataStoreEntity} objects by making sure they have an id property
   * with their unique identifiers attached.
   *
   * @param {Array} entities - the initial list of entities.
   * @returns Array<GCPDataStoreEntity> - list of processed entities with the id key and value.
   */
  addIdentifierToEachEntity(entities): Array<GCPDataStoreEntity> {
    return entities.map((entity) => {
      const id = entity[this.datastore.KEY].id
      return Object.assign(entity, { id })
    })
  }

  /**
   * Find a single {@link GCPDataStoreEntity} using its id.
   *
   * The underlying Google Cloud Datastore API allows the sending of multiple keys to retrieve
   * multiple {@link GCPDataStoreEntity}, but this method name has to map to a LoopBack repository
   * method that only retrieves a single {@link GCPDataStoreEntity} so that's how this method
   * is implemented.
   *
   * @param {String} model - name of the model defined in LoopBack's model annotation.
   *  For Example: @model({ name: Task.name })
   * @param {String} id - The Entity id
   */
  async findById(model: string, id: string): Promise<Array<GCPDataStoreEntity>> {
    try {
      const key = this.createEntityKeyWithId(model, id)

      const entities = await this.datastore.get(key)
      const foundEntity = entities[0]

      if (foundEntity) {
        const result = this.addIdentifierToEachEntity(entities)
        return Promise.resolve(result)
      }

      return Promise.resolve([])
    } catch (error) {
      console.error(error)
    }
  }

  /**
   * Get all entities for a given Kind.
   *
   * @param {String} model - name of the model defined in LoopBack's model annotation.
   *  For Example: @model({ name: Task.name })
   */
  private async getAllEntity(model) {
    try {
      const query = this.datastore.createQuery(model)
      const entities = await query.run()
      const result = this.addIdentifierToEachEntity(entities[0])
      return Promise.resolve(result)
    } catch (error) {
      console.error(error)
    }
  }

  /**
   * Helper method that returns true if it's not an array.
   *
   * @param valueToCheck - item to check.
   * @returns {boolean} - returns true if not an array and false if it's an array.
   */
  private static notAnArray(valueToCheck: any): boolean {
    return !Array.isArray(valueToCheck)
  }

  /**
   * Build a valid GQL query for the Google Datastore Node.js api.
   *
   * https://googleapis.dev/nodejs/datastore/latest/index.html
   *
   * @param {String} model - name of the model defined in LoopBack's model annotation.
   *  For Example: @model({ name: Task.name })
   * @param {Object} filters - the filter object containing filter conditions.
   */
  private buildQuery(model: string, filters): Query {
    const { where, limit, skip, fields } = filters
    let { order } = filters

    let query = this.datastore.createQuery(model)

    // if 'where' filter is present, extract all the different conditions
    if (where) {
      for (const key in where) {
        if (where.hasOwnProperty(key)) {
          const individualFilter: Filter = { [key]: where[key] }
          query = GoogleCloudDatastore.addWhereFilterToQuery(query, individualFilter)
        }
      }
    }

    // determine if it's ASC or DESC and return the JS object matching that order
    if (order) {
      if (GoogleCloudDatastore.notAnArray(order)) {
        order = [order]
      }

      // fast exit if no order
      if (order.length < 1) {
        return
      }

      for (const option of order) {
        // example:
        // order: 'price DESC',
        const [property, orderOption] = option.split(' ')
        if (orderOption) {
          query = query.order(property, GoogleCloudDatastore.generateOrderingObject(orderOption))
        } else {
          console.error('No order provided for property. Please provide DESC or ASC sort order.')
        }
      }
    }

    // how many entities should be returned
    if (limit) {
      query = query.limit(limit)
    }

    // how many entities to skip for pagination
    if (skip) {
      query = query.offset(skip)
    }

    // which fields on an entity should be returned
    if (fields) {
      const selects = fields.filter((field) => field === true)
      query = query.select(selects)
    }

    return query
  }

  /**
   * Get {@link GCPDataStoreEntity} with query execution.
   *
   * @param {String} model - name of the model defined in LoopBack's model annotation.
   *  For Example: @model({ name: Task.name })
   * @param {Object} filter - the filter for querying {@link GCPDataStoreEntity}.
   */
  private async getResultsWithQuery(model, filter): Promise<Array<GCPDataStoreEntity>> {
    const query = this.buildQuery(model, filter)
    const entities = await query.run()
    return this.addIdentifierToEachEntity(entities[0])
  }

  /**
   * Internal method - Check if filter object has at least one valid property.
   *
   * @param {Object} filter - the filters object.
   * @returns whether the filters object contains filters.
   */
  private static hasFilter({ where, order, limit, fields, skip }: Filter): boolean {
    return !!(where || limit || fields || order || skip)
  }

  /**
   * Find matching {@link GCPDataStoreEntity} using a filter.
   *
   * @param {String} model - name of the model defined in LoopBack's model annotation.
   *  For Example: @model({ name: Task.name })
   * @param {Object} filter - the filters object narrowing down which data to fetch.
   * @param {Object} _options - the options object
   * @param {Function} [callback] - the callback function
   */
  async all(
    model: string,
    filter: Filter,
    _options: CallOptions,
    callback: CallbackFunction,
  ): Promise<void> {
    try {
      const { where } = filter

      let result

      if (where && where.id) {
        result = await this.findById(model, where.id)
      } else if (GoogleCloudDatastore.hasFilter(filter)) {
        result = await this.getResultsWithQuery(model, filter)
      } else {
        result = await this.getAllEntity(model)
      }

      callback(null, result)
    } catch (error) {
      console.error(error)
    }
  }

  /**
   * Generate ordering object to use in the datastore query.
   *
   * @param {String} orderOption <ASC|DESC> Order option
   */
  private static generateOrderingObject(orderOption): OrderQuery {
    if (orderOption.toUpperCase() === 'DESC') return { descending: true }
    return { ascending: true }
  }

  /**
   * Add new filter to a Query.
   *
   * {
   *   where: {
   *     size: {
   *       eq: 'large' // addWhereFilterToQuery starts with this level
   *     }
   *   }
   * }
   *
   * @param {Query} query - Datastore {@link Query}.
   * @param {Object} filter - a filter condition. There can be nested conditions.
   * @returns {Query} - if there are no comparison queries other than the straight-forward equals
   *  comparison, then add the equals comparison to the root query and return the query. Else,
   *  parse and add each individual comparison query and add them to the root query before
   *  returning it.
   */
  private static addWhereFilterToQuery(query: Query, filter: Filter): Query {
    const key = Object.keys(filter)[0]
    const value = Object.values(filter)[0]

    const isObject = typeof value === 'object'

    if (isObject) {
      return GoogleCloudDatastore.addComparisonFiltersToQuery(query, key, value)
    }

    return query.filter(key, '=', value)
  }

  /**
   * Add comparison filters to a Query.
   *
   * @param {Query} query - Datastore {@link Query}.
   * @param {String} key - property name being filtered.
   * @param {Object} value - object with operator and comparison value.
   */
  private static addComparisonFiltersToQuery(query: Query, key: string, value: any): Query {
    let resultingQuery = query

    for (const operation in value) {
      if (value.hasOwnProperty(operation)) {
        const comparison = value[operation]
        let operator = undefined
        switch (operation) {
          case 'lt':
            operator = '<'
            break
          case 'lte':
            operator = '<='
            break
          case 'gt':
            operator = '>'
            break
          case 'gte':
            operator = '>='
            break
          case 'ne':
            operator = '!='
            break
          case 'in':
            operator = 'in'
            break
          default:
            break
        }
        resultingQuery = resultingQuery.filter(key, operator, comparison)
      }
    }

    return resultingQuery
  }

  /**
   * Count the number of {@link GCPDataStoreEntity} belonging to a given {@link EntityKey}. Do not
   * use this method if you can help it because it is incredibly taxing. Fetching all the records in
   * the collection just to determine the count. You are better off creating a tracker under a
   * {@link EntityKey} e.g. EntityCounts. Then each Entity in that collection is responsible for
   * tracking the count of records in another collection.
   *
   * Note: LoopBack repository's "exist" method also uses this "count" method to determine whether
   * or not a {@link GCPDataStoreEntity} exists. If you make a call like:
   * this.userRepository.exists('394628734637'), the the id will be transformed into a where filter
   * and passed to this method. That's why we check for (where && where.id).
   *
   * When using LoopBack repository's "exist" method, the length passed to the callback will
   * be transformed to a boolean and when the "count" method is used, it will be transformed into
   * a {@link LoopBackCountResult} object.
   *
   * Fixed bug in
   * [inspired source](https://github.com/henriquecarv/loopback-connector-google-cloud-datastore)
   * where the null results weren't being filtered out, resulting in an inaccurate count and
   * a 100% false positive rate when using LoopBack 4's exist method.
   *
   * @param {String} model - name of the model defined in LoopBack's model annotation.
   *  For Example: @model({ name: Task.name })
   * @param {Object} where - a filter containing "where" conditions
   *  https://loopback.io/doc/en/lb4/Where-filter.html
   * @param {Object} options - the options object
   * @param {Function} callback - the callback function
   */
  async count(
    model: string,
    where: Filter,
    options: CreateReadStreamOptions,
    callback,
  ): Promise<void> {
    try {
      // if there is a specified filter, or when using LoopBack's exist method.
      if (where && where.id) {
        const key = this.createEntityKeyWithId(model, where.id)
        const result = await this.datastore.get(key, options)
        callback(null, result.filter((entity) => entity != null).length)
        return
      }

      // get all entities and then retrieve basic array length
      const result = await this.getAllEntity(model)
      callback(null, result.length)
    } catch (error) {
      console.error(error)
    }
  }

  private async updateEntity(model: string, id: string, data: object): Promise<Count> {
    const key = this.createEntityKeyWithId(model, id)
    const updateResponse = (await this.datastore.update({
      key,
      data,
    })) as UpdateResponse
    const updatedRows = updateResponse[0].mutationResults.length
    return { count: updatedRows }
  }

  /**
   * Update matching {@link GCPDataStoreEntity} with new values.
   *
   * @param {String} model - name of the model defined in LoopBack's model annotation.
   *  For Example: @model({ name: Task.name })
   * @param {Object} filter The filter object
   * @param {Object} data The property/value pairs to be updated
   * @param {Object} _options The options object
   * @param {Function} callback The callback function
   */
  async update(
    model: string,
    filter: Filter,
    data,
    _options: CallOptions,
    callback: CallbackFunction,
  ) {
    try {
      const { where } = filter

      // Handle ".updateById" from LoopBack
      if (filter && filter.id) {
        callback(null, await this.updateEntity(model, filter.id, data))
        return
      }
      // Handle update if just one entity. ".update" method in LoopBack's crud repository.
      else if (where && where.id) {
        callback(null, await this.updateEntity(model, where.id, data))
        return
      }

      // Handle multiple entity updates
      // Get existing entities that will need to be updated based on query
      const entities = await this.getResultsWithQuery(model, filter)
      // Assign new data to existing entities
      const newEntities = entities.map((entity: GCPDataStoreEntity) => {
        return Object.assign(entity, data)
      })
      // Update those entities
      const updateResponse = (await this.datastore.update(newEntities)) as UpdateResponse
      const commitResult = updateResponse[0]
      const updatedRows = commitResult.mutationResults.length
      callback(null, { count: updatedRows })
    } catch (error) {
      console.error(error)
    }
  }

  /**
   * Destroy all {@link GCPDataStoreEntity} for a given Kind.
   *
   * This method is also used by LoopBack repository's deleteById method, hence the check for
   * "where" and "where.id".
   *
   * @param {String} model - name of the model defined in LoopBack's model annotation.
   *  For Example: @model({ name: Task.name })
   * @param {Object} where - the filter object
   * @param {Object} options - the options object
   * @param {Function} [callback] - the callback function
   */
  async destroyAll(model: string, where: Filter, options: CallOptions, callback: CallbackFunction) {
    try {
      if (where && where.id) {
        const key = this.createEntityKeyWithId(model, where.id)
        const result = (await this.datastore.delete(key, options)) as CommitResponse
        const commitResult = result[0]
        const deletedRows = commitResult.mutationResults.length
        // LoopBack expects result to be an object with a count property
        callback(null, { count: deletedRows })
      } else {
        const result = await this.getAllEntity(model)
        const keys = result.map((entity: GCPDataStoreEntity) => {
          return this.createEntityKeyWithId(model, entity.id)
        })
        const deleteResult = (await this.datastore.delete(keys)) as DeleteResponse
        const commitResult = deleteResult[0]
        const deletedRows = commitResult.mutationResults.length
        // LoopBack expects result to be an object with a count property
        callback(null, { count: deletedRows })
      }
    } catch (error) {
      console.error(error)
    }
  }
}

// // Required by LoopBack to be in this commonjs format
exports.initialize = initializeDataSource
exports.RealtimeDatabase = GoogleCloudDatastore
