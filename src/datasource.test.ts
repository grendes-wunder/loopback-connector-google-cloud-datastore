import { DataSource } from 'loopback-datasource-juggler'
import DoneCallback = jest.DoneCallback

const GCPDataSource = require('./datasource').RealtimeDatabase

function getDatasource() {
  try {
    const config = {
      projectId: process.env.DATASTORE_PROJECT_ID,
      keyFilename: 'package.json', // not required for datasource emulator
    }
    const db = new DataSource(null, {})
    db.connector = new GCPDataSource(config)
    return db
  } catch (error) {
    console.error('Init test error: ', error)
  }
}

const datasource = getDatasource()

const Customer: any = datasource.createModel('customer', {
  name: String,
  emails: [String],
  type: String,
  age: Number,
})

describe('Test Google Cloud Datastore Connector', () => {
  const customerName = 'Clement Oh'

  let customer1 = undefined
  let customer2 = undefined

  /**
   * Have to create all the entities up front because the eventual consistency nature
   * of datastore can cause the 'find' query to return unexpected results, especially
   * if you're querying for the data immediately after it has been persisted.
   */
  beforeAll((done: DoneCallback) => {
    Customer.destroyAll((error) => {
      error ? console.error(error) : ''

      Customer.create(
        {
          name: customerName,
          emails: ['noreply@example.com', 'info@example.com'],
          type: 'Animal',
          age: 2,
        },
        (error, customer) => {
          customer1 = customer
          expect(customer.name).toEqual(customerName)
          expect(customer.emails.length).toEqual(2)
          error ? console.error(error) : ''

          Customer.create(
            {
              name: customerName,
              emails: ['orion@cruz.com'],
              type: 'Animal',
              age: 27,
            },
            (error, customer) => {
              customer2 = customer
              expect(customer.name).toEqual(customerName)
              expect(customer.emails.length).toEqual(1)
              // delay starting first test to allow eventual consistency mechanism to
              // propagate changes, otherwise queries may return unexpected results.
              setTimeout(() => {
                error ? done(error) : done()
              }, 1000)
            },
          )
        },
      )
    })
  })

  it('Should count 2 entities', (done: DoneCallback) => {
    Customer.find({}, (error, customers) => {
      expect(Array.isArray(customers)).toBeTruthy()
      expect(customers.length).toEqual(2)
      error ? done(error) : done()
    })
  })

  it('Should find an Entity by id', (done: DoneCallback) => {
    Customer.find({ where: { id: customer1.id } }, (error, customers) => {
      expect(Array.isArray(customers)).toBeTruthy()
      expect(customers.length).toEqual(1)
      const savedCustomer = customers[0]
      expect(savedCustomer.id).toEqual(customer1.id)
      error ? done(error) : done()
    })
  })

  it('Should get object properties', (done: DoneCallback) => {
    Customer.find({ where: { id: customer1.id } }, (error, customers) => {
      expect(Array.isArray(customers)).toBeTruthy()
      expect(customers.length).toEqual(1)
      const savedCustomer = customers[0]
      expect(savedCustomer.name).toEqual(customer1.name)
      expect(savedCustomer.age).toEqual(customer1.age)
      error ? done(error) : done()
    })
  })

  it('Should get all entities', (done: DoneCallback) => {
    Customer.all((error, customers) => {
      expect(Array.isArray(customers)).toBeTruthy()
      expect(customers.length).toEqual(2)
      const savedCustomer1 = customers[0]
      const savedCustomer2 = customers[1]
      expect(savedCustomer1.id).toEqual(customer1.id)
      expect(savedCustomer2.id).toEqual(customer2.id)
      error ? done(error) : done()
    })
  })

  it('Should get one entity from all using limit filter', (done: DoneCallback) => {
    Customer.all({ limit: 1 }, (error, customers) => {
      expect(Array.isArray(customers))
      expect(customers[0].id).toEqual(customer1.id)
      error ? done(error) : done()
    })
  })

  it('Should get Orion as first Entity in the array', (done: DoneCallback) => {
    Customer.all({ order: 'age DESC' }, (error, customers) => {
      expect(Array.isArray(customers))
      expect(customers.length).toEqual(2)
      expect(customers[0].id).toEqual(customer2.id)
      error ? done(error) : done()
    })
  })

  it('Should get a specific field from all entities', (done: DoneCallback) => {
    Customer.all({ fields: { emails: true } }, (error, customers) => {
      expect(Array.isArray(customers))
      expect(customers.length).toEqual(2)
      const savedCustomer1 = customers[0]
      expect(savedCustomer1.emails).toEqual(customer1.emails)
      expect(savedCustomer1.age).toEqual(undefined)
      error ? done(error) : done()
    })
  })

  it('Should find entities by age less than 28', (done: DoneCallback) => {
    Customer.find({ where: { age: { lt: 28 } } }, (error, customers) => {
      expect(Array.isArray(customers))
      expect(customers.length).toEqual(2)
      const savedCustomer1 = customers[0]
      expect(savedCustomer1.age).toEqual(customer1.age)
      expect(savedCustomer1.id).toEqual(customer1.id)
      error ? done(error) : done()
    })
  })

  it('Should find an entity by age equals to 2', (done: DoneCallback) => {
    Customer.find({ where: { age: customer1.age } }, (error, customers) => {
      expect(Array.isArray(customers))
      expect(customers.length).toEqual(1)
      const savedCustomer1 = customers[0]
      expect(savedCustomer1.age).toEqual(customer1.age)
      expect(savedCustomer1.id).toEqual(customer1.id)
      error ? done(error) : done()
    })
  })

  it('Should replace values for models with same property value', (done: DoneCallback) => {
    const newEmails = ['animal@example.com']
    Customer.update({ where: { type: 'Animal' } }, { emails: newEmails }, (error, updateResult) => {
      expect(updateResult.count).toEqual(2)
      error ? done(error) : done()
    })
  })

  it('Should replace attributes for a model entity', (done: DoneCallback) => {
    Customer.replaceById(customer1.id, { emails: ['bar@example.com'] }, (error, customer) => {
      expect(customer.emails.length).toEqual(1)
      error ? done(error) : done()
    })
  })

  it('Should delete an entity', (done: DoneCallback) => {
    Customer.destroyAll({ id: customer1.id }, (error, deleteResult) => {
      expect(deleteResult.count).toEqual(1)
      if (error) done(error)
      Customer.destroyAll(null, (error, deleteResult) => {
        expect(deleteResult.count).toEqual(1)
        error ? done(error) : done()
      })
    })
  })
})
