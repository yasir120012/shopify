import { useEffect, useState } from "react";
import { json } from "@remix-run/node";
import { useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  Box,
  InlineStack,
  TextField,
  Modal,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { useNavigate } from "react-router-dom";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }) => {
  const formData = await request.formData();
  const searchTerm = formData.get("searchTerm");
  const productIdToDelete = formData.get("productIdToDelete");
  const actionType = formData.get("actionType");

  try {
    const { admin } = await authenticate.admin(request);

    if (productIdToDelete) {
      const deleteMutation = `
        mutation {
          productDelete(input: { id: "${productIdToDelete}" }) {
            deletedProductId
            userErrors {
              field
              message
            }
          }
        }
      `;
      const deleteResponse = await admin.graphql(deleteMutation);
      const deleteResponseJson = await deleteResponse.json();

      if (
        deleteResponseJson.errors ||
        deleteResponseJson.data.productDelete.userErrors.length
      ) {
        throw new Error("Failed to delete product");
      }

      return json({ message: "Product deleted successfully" });
    }

    if (actionType === "fetchProducts") {
      let query = `
        {
          products(first: 100) {
            edges {
              node {
                id
                title
                priceRange {
                  minVariantPrice {
                    amount
                    currencyCode
                  }
                }
                status
                vendor
                images(first: 1) {
                  edges {
                    node {
                      transformedSrc
                    }
                  }
                }
                variants(first: 10) {
                  edges {
                    node {
                      id
                      inventoryQuantity
                    }
                  }
                }
              }
            }
          }
        }
      `;

      if (searchTerm) {
        query = `
          {
            products(first: 100, query: "title:*${searchTerm}*") {
              edges {
                node {
                  id
                  title
                  priceRange {
                    minVariantPrice {
                      amount
                      currencyCode
                    }
                  }
                  status
                  vendor
                  images(first: 1) {
                    edges {
                      node {
                        transformedSrc
                      }
                    }
                  }
                  variants(first: 10) {
                    edges {
                      node {
                        id
                        inventoryQuantity
                      }
                    }
                  }
                }
              }
            }
          }
        `;
      }

      const response = await admin.graphql(query);
      const responseJson = await response.json();

      const products = responseJson.data.products.edges.map(({ node }) => ({
        ...node,
        priceRange: {
          ...node.priceRange,
          minVariantPrice: {
            ...node.priceRange.minVariantPrice,
            amount: (node.priceRange.minVariantPrice.amount / 100).toFixed(2),
          },
        },
      }));

      return json({ products });
    } else if (actionType === "updateProduct") {
      const productId = formData.get("productId");
      const updatedTitle = formData.get("updatedTitle");
      let updatedPrice = formData.get("updatedPrice");
      const variantId = formData.get("variantId");

      if (updatedPrice) {
        updatedPrice = parseFloat(updatedPrice).toFixed(2);
      } else {
        return json({ error: "Invalid price" }, { status: 400 });
      }

      const response = await admin.graphql(`
        mutation {
          productUpdate(input: { id: "${productId}", title: "${updatedTitle}" }) {
            product {
              id
              title
            }
            userErrors {
              field
              message
            }
          }
          productVariantUpdate(input: { id: "${variantId}", price: "${updatedPrice}" }) {
            productVariant {
              id
              price
            }
            userErrors {
              field
              message
            }
          }
        }
      `);
      const responseJson = await response.json();
      return json({
        updatedProduct: responseJson.data.productUpdate.product,
        errors: responseJson.errors,
      });
    }
  } catch (error) {
    console.error("Error:", error);
    throw new Error("Failed to process request");
  }

  return null;
};

export default function Index() {
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [filteredProducts, setFilteredProducts] = useState([]);
  const [updateTitle, setUpdateTitle] = useState("");
  const [updatePrice, setUpdatePrice] = useState("");
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [selectedVariantId, setSelectedVariantId] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState(null);

  const isLoading =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  const defaultPlaceholderImage =
    "https://via.placeholder.com/100?text=No+Image";

  useEffect(() => {
    if (fetcher.data?.products) {
      shopify.toast.show("Products fetched");
      setFilteredProducts(fetcher.data.products);
    }
    if (fetcher.data?.message) {
      shopify.toast.show(fetcher.data.message);
      fetchProducts();
    }
    if (fetcher.data?.updatedProduct) {
      shopify.toast.show(
        `Product updated: ${fetcher.data.updatedProduct.title}`,
      );
      fetchProducts();
      setModalOpen(false);
    }
    if (fetcher.data?.error) {
      shopify.toast.show(`Error: ${fetcher.data.error}`);
    }
    if (fetcher.data?.errors) {
      shopify.toast.show(
        `GraphQL Errors: ${JSON.stringify(fetcher.data.errors)}`,
      );
    }
  }, [fetcher.data, shopify]);

  const fetchProducts = () =>
    fetcher.submit({ actionType: "fetchProducts" }, { method: "POST" });

  const handleSearchChange = (value) => {
    setSearchTerm(value);
  };

  const handleSearch = () => {
    if (!searchTerm.trim()) {
      shopify.toast.show({
        content: "Search field cannot be empty.",
        duration: 5000,
        isError: true,
      });
      return;
    }

    fetcher.submit(
      { searchTerm, actionType: "fetchProducts" },
      { method: "POST" },
    );
  };

  const handleDeleteClick = (productId) => {
    setProductToDelete(productId);
    setDeleteModalOpen(true);
  };

  const confirmDeleteProduct = () => {
    fetcher.submit(
      { productIdToDelete: productToDelete, actionType: "deleteProduct" },
      { method: "POST" },
    );
    setDeleteModalOpen(false);
  };

  const openModal = (productId, variantId, currentTitle, currentPrice) => {
    setSelectedProductId(productId);
    setSelectedVariantId(variantId);
    setUpdateTitle(currentTitle);
    setUpdatePrice(currentPrice);
    setModalOpen(true);
  };

  const updateProduct = () => {
    if (selectedProductId && selectedVariantId) {
      fetcher.submit(
        {
          actionType: "updateProduct",
          productId: selectedProductId,
          updatedTitle: updateTitle,
          updatedPrice: updatePrice,
          variantId: selectedVariantId,
        },
        { method: "POST" },
      );
    }
  };

  const closeModal = () => {
    setModalOpen(false);
  };

  const closeDeleteModal = () => {
    setDeleteModalOpen(false);
  };

  const cardStyles = {
    container: {
      padding: "20px",
      marginBottom: "20px",
      borderRadius: "10px",
      boxShadow: "0 2px 4px rgba(0, 0, 0, 0.1)",
    },
    title: {
      fontSize: "18px",
      fontWeight: "600",
      marginBottom: "10px",
    },
    section: {
      display: "flex",
      flexDirection: "column",
      gap: "10px",
      padding: "10px",
    },
    image: {
      width: "100px",
      height: "100px",
      objectFit: "cover",
      borderRadius: "8px",
      border: "1px solid #dfe3e8",
    },
    productInfo: {
      display: "flex",
      flexDirection: "column",
      gap: "5px",
      padding: "10px",
    },
    buttonContainer: {
      display: "flex",
      gap: "10px",
      marginTop: "10px",
    },
  };

  return (
    <Page>
      <TitleBar title="Welcome">
        <Button primary onClick={fetchProducts}>
          Fetch Products
        </Button>
      </TitleBar>
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginBottom: "20px",
              }}
            >
              <InlineStack gap="300" align="center">
                <TextField
                  value={searchTerm}
                  onChange={handleSearchChange}
                  placeholder="Search products by name"
                />
                <Button onClick={handleSearch}>Search</Button>
              </InlineStack>
            </div>
            <Card>
              <BlockStack gap="500">
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Display Products from Shopify Store
                  </Text>
                  <InlineStack gap="300">
                    <Button loading={isLoading} onClick={fetchProducts}>
                      Display Products
                    </Button>
                  </InlineStack>
                  {filteredProducts.length > 0 ? (
                    <Card sectioned style={cardStyles.container}>
                      {filteredProducts.map((node) => (
                        <Box
                          key={node.id}
                          padding="10"
                          style={{
                            ...cardStyles.container,
                            backgroundColor: "#ffffff",
                          }}
                        >
                          <div style={{ padding: "10px" }}>
                            <img
                              src={
                                node.images.edges[0]?.node.transformedSrc ||
                                defaultPlaceholderImage
                              }
                              alt={node.title}
                              style={cardStyles.image}
                            />
                          </div>
                          <div style={cardStyles.productInfo}>
                            <Text style={cardStyles.title}>{node.title}</Text>
                            <Text>
                              <strong>Price:</strong> $
                              {node.priceRange.minVariantPrice.amount}
                            </Text>
                            <Text>
                              <strong>Status:</strong> {node.status}
                            </Text>
                            <Text>
                              <strong>Vendor:</strong> {node.vendor}
                            </Text>
                            <Text>
                              <strong>Inventory:</strong>
                            </Text>
                            <ul>
                              {node.variants.edges.map(({ node: variant }) => (
                                <li key={variant.id}>
                                  <strong>Variant ID:</strong> {variant.id},{" "}
                                  <strong>Inventory:</strong>{" "}
                                  {variant.inventoryQuantity}
                                </li>
                              ))}
                            </ul>
                          </div>
                          <div style={cardStyles.buttonContainer}>
                            <Button
                              onClick={() =>
                                openModal(
                                  node.id,
                                  node.variants.edges[0]?.node.id,
                                  node.title,
                                  node.priceRange.minVariantPrice.amount,
                                )
                              }
                            >
                              Update
                            </Button>
                            <Button
                              destructive
                              onClick={() => handleDeleteClick(node.id)}
                            >
                              Delete
                            </Button>
                          </div>
                        </Box>
                      ))}
                    </Card>
                  ) : (
                    <Text>No products found</Text>
                  )}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title="Update Product"
        primaryAction={{
          content: "Save Changes",
          onAction: updateProduct,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: closeModal,
          },
        ]}
      >
        <Modal.Section>
          <TextField
            label="Title"
            value={updateTitle}
            onChange={(value) => setUpdateTitle(value)}
            placeholder="Enter new title"
          />
          <TextField
            label="Price"
            value={updatePrice}
            onChange={(value) => setUpdatePrice(value)}
            placeholder="Enter new price"
            type="number"
            min="0"
            step="0.01"
          />
        </Modal.Section>
      </Modal>

      <Modal
        open={deleteModalOpen}
        onClose={closeDeleteModal}
        title="Confirm Delete"
        primaryAction={{
          content: "Delete",
          destructive: true,
          onAction: confirmDeleteProduct,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: closeDeleteModal,
          },
        ]}
      >
        <Modal.Section>
          <Text>Are you sure you want to delete this product?</Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
