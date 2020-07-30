# loopback-connector-google-cloud-datastore

Google Cloud Datastore [connector](https://loopback.io/doc/en/lb4/Connectors-reference.html) for the LoopBack framework.

## System Requirements

- **[NodeJS](https://nodejs.org/en/)** (version >= 10).

## Inspiration

[Henrique Carvalho da Cruz (henriquecarv)](https://github.com/henriquecarv) -
[Original Datastore Conenctor](https://github.com/henriquecarv/loopback-connector-google-cloud-datastore)

## Motivation to create new connector

The [original connector](https://github.com/henriquecarv/loopback-connector-google-cloud-datastore) was an **awesome**
starting point, but this is why I decided to create a new connector.

- I'm not sure if it's because of LoopBack 4 doing things differently to LoopBack 2 or 3, which is when
  this plugin was written, but there were errors that weren't being handled properly and made the connector hard to
  use within the confines of LoopBack 4.
- There were very inefficient calls made, such as fetching the entire list of items before updating them when the
  Datastore node api allows you to pass keys and data to handle the operation in a single network call and operation.
- Add usage of datastore emulator to run integration tests using Docker Compose instead of connecting to a real
  Datastore setup using a service account. Will reduce costs significantly and increase repeatability.
- The methods didn't have much documentation to explain what was going on.
- The library wasn't typed so it was difficult to not very easy to navigate the source and understand what was going on.
- After reading the documentation for LoopBack framework repositories and
  [original connector](https://github.com/henriquecarv/loopback-connector-google-cloud-datastore) I still found it very
  difficult to connect because the setup process was not aligned with the framework version.

## Installation

LoopBack v4 is an incredibly powerful framework that utilizes best practice and proven patterns in enterprise and
large scale projects through-and-through. If you're familiar with the Java [Spring Framework](https://spring.io/)
then you should feel right at home. LoopBack has more constructs to wire up before getting started, but the patterns
are similar. If you want to know how to get started with Loopback [check this](http://loopback.io/getting-started/).

**Install the package:**
```bash
npm install --save @gavel/loopback-connector-google-cloud-datastore
# or
yarn install @gavel/loopback-connector-google-cloud-datastore
```

To add a new data source, use the data source generator:

```bash
lb4 datasource
```

Then the data source generator will prompt some questions like

```bash
- Enter the data-source name: GoogleCloudDatastore _(Choose your prefered name)_
- Select the connector for GoogleCloudDatastore: other
- Enter the connector's module name @gavel/loopback-connector-google-cloud-datastore
- Install loopback-connector-google-cloud-datastore (Y/n) y
```

If you don't already have a JSON key for your service account, go to
[Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts) in the Google Cloud Platform Console
and generate a new private key and save the JSON file.

It should look something like this:

```json
{
  "type": "service_account",
  "project_id": "",
  "private_key_id": "",
  "private_key": "",
  "client_email": "",
  "client_id": "",
  "auth_uri": "",
  "token_uri": "",
  "auth_provider_x509_cert_url": "",
  "client_x509_cert_url": ""
}
```

To test it out on your local machine, copy the **absolute** path to the JSON file, so you can use it in your datasource
configuration.

**src/datasources/google-cloud-datastore.datasource.ts** (or whatever your chosen name was during the generationnprocess)

```typescript
import { inject, lifeCycleObserver, LifeCycleObserver } from '@loopback/core'
import { juggler } from '@loopback/repository'

const config = {
  name: 'GoogleCloudDatastore',
  connector: '@gavel/loopback-connector-google-cloud-datastore',
  projectId: '<GCP_PROJECT_ID>',
  keyFilename: '<ABSOLUTE_PATH_TO_JSON_KEY>',
}

// Observe application's life cycle to disconnect the datasource when
// application is stopped. This allows the application to be shut down
// gracefully. The `stop()` method is inherited from `juggler.DataSource`.
// Learn more at https://loopback.io/doc/en/lb4/Life-cycle.html
@lifeCycleObserver('datasource')
export class GoogleCloudDatastoreDataSource extends juggler.DataSource
  implements LifeCycleObserver {
  static dataSourceName = 'GoogleCloudDatastore'
  static readonly defaultConfig = config

  constructor(
    @inject('datasources.config.GoogleCloudDatastore', { optional: true })
    dsConfig: object = config,
  ) {
    super(dsConfig)
  }
}
```

Because [LoopBack v4][1] uses configuration directly from TypeScript and not JSON files like it did in LoopBack v3, it
is much easier to provide dynamic configuration using environment variables. The best way to store secrets is outside
the scope of this project, but please don't commit it 😱

Once you have set up the connection to a datasource. You will need a
[repository](https://loopback.io/doc/en/lb4/Repositories.html) and a [model](https://loopback.io/doc/en/lb4/Model.html)
(if you don't already have one) to start querying the datasource.

### Models

If you already have a model, skip to the [repositories](#repositories) section.

To create a model, use the LoopBack cli command:

```bash
lb4 model

? Model class name: User
? Please select the model base class: // select Entity (A persisted model with an ID)
? Allow additional (free-form) properties? Yes
Model User will be created in src/models/user.model.ts
Let's add a property to User
Enter an empty property name when done
? Enter the property name: // can leave empty and hit enter for now
```

### Repositories

To generate a new repository, just run the cli command:

```bash
lb4 repository
```

Hit enter to choose the `GoogleCloudDatastoreDatasource` datasource. This will match the class name of the datasource
you created in the previous CLI step.

Then use the up or down arrows to navigate the existing models and press space to choose the model you would like to
associate with this repository.

Hit enter and enter again to choose the model and the `DefaultCrudRepository`.

You should find something like this in your `src/repositories` directory substituted for the model you chose.

```typescript
import { DefaultCrudRepository } from '@loopback/repository'
import { GoogleCloudDatastoreDataSource } from '../datasources'
import { inject } from '@loopback/core'
import { User } from '../models'

export class UserRepository extends DefaultCrudRepository<User, typeof User.prototype.id> {
  constructor(
    @inject('datasources.GoogleCloudDatastore') dataSource: GoogleCloudDatastoreDataSource,
  ) {
    super(User, dataSource)
  }
```

The final step is to inject it into a service so you can use the repository to query your datasource.

```typescript
import { bind, BindingScope } from '@loopback/core'
import { repository } from '@loopback/repository'
import { User } from '../models'
import { UserRepository } from '../repositories'

@bind({ scope: BindingScope.TRANSIENT })
export class UserService {
  constructor(@repository(UserRepository) private userRepository: UserRepository) {}

  /**
   * Create new User.
   *
   * @param {string} email - email to send user information.
   * @param {string} password - plain text password that will be hashed before being stored in db.
   */
  createUser(email: string, password: string) {
    const newUser = new User({
      id: '5679095853613056',
      email: 'example@example.com',
      password: '<SOME_HASHED_VALUE>',
    })
    // const filter = {
    //   where: {
    //     and: [{ email: 'example@example.com' }, { password: '1235' }],
    //   },
    // }
    this.userRepository
      .create(newUser)
      // .findOne({
      //   where: {
      //     email: 'example@example.com',
      //   },
      // })
      // .then(() => {
      //   this.userRepository.findOne({
      //     where: {
      //       email: 'example@example.com',
      //     },
      //   })
      // })
      // .findById('5072058866204672')
      // .find(filter)
      // .exists('5143677177430016')
      // .destroyById('5143677177430016')
      // .deleteAll()
      // .update(newUser)
      .then((result) => console.log('result:', result))
      .catch((error) => console.error('error:', error))
  }
}
```

### License

Copyrighted (c) 2020 [Clement Oh][3] Licensed under the [MIT license][2].

[1]: https://loopback.io/doc/en/lb4/
[2]: LICENSE
[3]: https://github.com/clementohNZ
