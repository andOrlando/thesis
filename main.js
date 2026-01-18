class Dog {
  get #bark() {
    return "woof"
  }
  bark() { return this.#bark }

}
(new Dog()).bark()
